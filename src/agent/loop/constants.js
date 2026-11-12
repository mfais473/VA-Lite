const maxSteps = () => Number(process.env.VIA_MAX_AGENT_STEPS) || 6;
const maxCodingSteps = () => Number(process.env.VIA_MAX_CODING_STEPS) || 24;
const CONFIRM_TTL_MS = 2 * 60 * 1000;
const INQUIRY_TTL_MS = 5 * 60 * 1000;
const MAX_INQUIRY_QUESTIONS = 5;
const INQUIRY_ARGS_CHARS = 6000;
const NEW_REQUEST_MIN_WORDS = 7;
const MAX_SAME_FAILURES = 3;
const MAX_TRUNCATION_RECOVERIES = 1;
const MAX_TRUNC_ARGS_STREAK = 2;

module.exports = {
  maxSteps, maxCodingSteps,
  get MAX_STEPS() { return maxSteps(); },
  get MAX_CODING_STEPS() { return maxCodingSteps(); },
  CONFIRM_TTL_MS, INQUIRY_TTL_MS, MAX_INQUIRY_QUESTIONS, INQUIRY_ARGS_CHARS,
  NEW_REQUEST_MIN_WORDS, MAX_SAME_FAILURES, MAX_TRUNCATION_RECOVERIES, MAX_TRUNC_ARGS_STREAK,
};
