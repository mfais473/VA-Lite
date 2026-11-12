const llm = require('../ai/llm-client');
const tools = require('../tools');
const workspace = require('../workspace/workspace');
const { SYSTEM_PROMPT } = require('../ai/prompt-builder');
const { classifyConfirmation, classifyInquiry, looksLikeQuestion } = require('./confirmation');
const { choosePhase } = require('./phase-policy');
const {
  maxSteps, maxCodingSteps, CONFIRM_TTL_MS, INQUIRY_TTL_MS, MAX_INQUIRY_QUESTIONS, NEW_REQUEST_MIN_WORDS,
  MAX_SAME_FAILURES, MAX_TRUNCATION_RECOVERIES, MAX_TRUNC_ARGS_STREAK,
} = require('./loop/constants');
const { TRUNCATION_NUDGE, INQUIRY_PROMPT, INQUIRY_REMINDER } = require('./loop/messages');
const { state, hasPending, cancelPending, takePartialProgress, setNow, reset } = require('./loop/state');
const { permissionPrompt, askResult, truncationGiveUp, doneResult } = require('./loop/results');
const { needsConfirm } = require('./loop/permission');
const { processQueue, flushToolResults } = require('./loop/queue');
const { historyMessages, syncContextNote } = require('./loop/context');
const { answerInquiry, enterInquiry } = require('./loop/inquiry');

async function runLoop(run) {
  for (;;) {
    const stepLimit = run.codingActive ? maxCodingSteps() : maxSteps();
    const toolsAllowed = run.toolsEnabled && run.step < stepLimit - 1;
    const phase = choosePhase(run);
    syncContextNote(run);
    if (!run.allTools) run.allTools = tools.getToolSchemas();
    const stepTools = toolsAllowed ? run.allTools : [];
    const out = await llm.callLLM({
      system: SYSTEM_PROMPT,
      messages: run.messages,
      tools: stepTools,
      stableTools: run.allTools,
      phase,
    });
    run.step += 1;
    console.log(
      `[agent] langkah ${run.step} (${phase}):`,
      out.toolCalls && out.toolCalls.length
        ? `panggil ${out.toolCalls.map((c) => c.name).join(', ')}`
        : `teks: ${(out.text || '').slice(0, 80)}`
    );

    if (out.truncated && !String(out.text || '').trim() && !(out.toolCalls && out.toolCalls.length)) {
      if (run.truncRecoveries < MAX_TRUNCATION_RECOVERIES) {
        run.truncRecoveries += 1;
        console.warn('[agent] keluaran terpotong tanpa hasil; mengulang sekali dengan catatan pemulihan');
        run.messages.push({ role: 'note', text: TRUNCATION_NUDGE });
        continue;
      }
      return doneResult(run, truncationGiveUp(run, phase, 'tanpa jawaban'));
    }
    const argsTruncated = Boolean(out.truncated) && (out.toolCalls || []).some((c) => c.argsError);
    run.truncArgsStreak = argsTruncated ? run.truncArgsStreak + 1 : 0;
    if (run.truncArgsStreak >= MAX_TRUNC_ARGS_STREAK) {
      return doneResult(run, truncationGiveUp(run, phase, 'argumen tool tidak lengkap'));
    }

    const calls = toolsAllowed ? out.toolCalls || [] : [];
    run.messages.push({
      role: 'assistant',
      text: out.text || '',
      toolCalls: calls,
      rawGemini: calls.length ? out.rawGemini : undefined,
      rawAnthropic: calls.length ? out.rawAnthropic : undefined,
    });

    if (!calls.length) {
      const text = out.truncated && out.text ? out.text + (llm.TRUNCATED_TEXT_NOTE || '') : out.text;
      return doneResult(run, text);
    }

    run.queue = calls.map((c) => ({ ...c }));
    run.queueIndex = 0;
    const asked = await processQueue(run);
    if (asked) return asked;
    flushToolResults(run);
  }
}

async function startTurn(userText) {
  state.pending = null;
  const run = {
    userText,
    messages: [...historyMessages(), { role: 'user', text: userText }],
    hasImages: false,
    step: 0,
    tainted: false,
    codingActive: false,
    denied: false,
    halted: false,
    toolsEnabled: true,
    executed: [],
    notes: [],
    failures: {},
    queue: [],
    queueIndex: 0,
    lastContext: '',
    truncRecoveries: 0,
    truncArgsStreak: 0,
  };
  state.currentRun = run;
  return runLoop(run);
}

async function settle(p, approved) {
  state.pending = null;
  const run = p.run;
  state.currentRun = run;
  if (approved) {
    p.call.approved = true;
  } else {
    run.denied = true;
    run.toolsEnabled = false;
  }
  const asked = await processQueue(run);
  if (asked) return asked;
  flushToolResults(run);
  return runLoop(run);
}

async function handleQuestion(p, userText) {
  if (p.inquiryCount >= MAX_INQUIRY_QUESTIONS) {
    return settle(p, false);
  }
  p.inquiryCount += 1;
  let answer = '';
  try {
    answer = await answerInquiry(p, userText);
  } catch (err) {
    console.warn('[agent] gagal menjawab pertanyaan izin:', err.message);
  }
  p.askedAt = state.now();      
  const last = p.inquiryCount >= MAX_INQUIRY_QUESTIONS ? ' Ini pertanyaan terakhir; setelah ini jawab ya atau tidak.' : '';
  const body = answer || 'Maaf, aku belum bisa menjawab itu.';
  return { done: false, rawText: `${body} ${INQUIRY_REMINDER}${last}`, userText: p.run.userText };
}

async function resume(userText) {
  const p = state.pending;
  const waitingTool = p && tools.getTool(p.call.name);
  const strict = Boolean(waitingTool && waitingTool.alwaysConfirm);

  if (p.kind === 'inquiry') {
    const d = classifyInquiry(userText, { strict });
    if (d === 'approve') return settle(p, true);
    if (d === 'deny') return settle(p, false);
    return handleQuestion(p, userText);
  }

  let decision = classifyConfirmation(userText, { strict });
  const wordCount = String(userText).split(/\s+/).filter(Boolean).length;
  if (strict && decision === 'approve' && wordCount >= NEW_REQUEST_MIN_WORDS) decision = 'unclear';

  if (decision === 'ask') {
    enterInquiry(p);
    if (looksLikeQuestion(userText)) return handleQuestion(p, userText);
    return askResult(p.run, INQUIRY_PROMPT);
  }

  if (decision === 'unclear') {
    const words = String(userText).split(/\s+/).filter(Boolean).length;
    if (words >= NEW_REQUEST_MIN_WORDS) {
      return startTurn(userText);
    }
    if (!p.reasked) {
      p.reasked = true;
      p.askedAt = state.now();
      return askResult(p.run, `Maaf, aku belum menangkap jawabanmu. ${p.question} Ya atau tidak?`);
    }
    return settle(p, false);
  }
  return settle(p, decision === 'approve');
}

async function answerPending(input) {
  if (!hasPending()) return null;
  const d = input === true ? 'approve' : input === false ? 'deny' : input;
  if (d === 'ask') {
    if (state.pending.kind !== 'inquiry') enterInquiry(state.pending);
    return askResult(state.pending.run, INQUIRY_PROMPT);
  }
  return settle(state.pending, d === 'approve');
}

module.exports = {
  startTurn, resume, answerPending, hasPending, cancelPending, takePartialProgress, MAX_SAME_FAILURES,
  MAX_INQUIRY_QUESTIONS, INQUIRY_TTL_MS, CONFIRM_TTL_MS,
  get MAX_STEPS() { return maxSteps(); },
  get MAX_CODING_STEPS() { return maxCodingSteps(); },
  __test: { needsConfirm, permissionPrompt, setNow, reset },
};
