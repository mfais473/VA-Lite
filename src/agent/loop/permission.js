const tools = require('../../tools');
const planGate = require('../plan-gate');

function needsConfirm(tool, call, run) {
  let confirm = tools.permissionOf(tool) === 'confirm' || (run.tainted && !tool.taintExempt);

  if (typeof tool.needsConfirm === 'function') {
    try {
      if (tool.needsConfirm(call.args, { tainted: run.tainted }) === true) confirm = true;
    } catch {
      confirm = true;
    }
  }

  if (tool.planGated === true && typeof tool.planOf === 'function') {
    const r = tool.planOf(call.args);
    if (r && r.ok) {
      const ev = planGate.evaluate(r.plan);
      if (ev.state === 'deviation') return { confirm: true, halt: ev.reasons };
      if (ev.state === 'over-budget') return { confirm: true, inPlan: true, extend: ev.needed, note: ev.note };
      if (ev.state === 'inside') {
        if (ev.auto && tools.permissionOf(tool) === 'confirm') return { confirm: false, inPlan: true };
        return { confirm: true, inPlan: true };
      }
    }
  }
  return { confirm };
}

module.exports = { needsConfirm };
