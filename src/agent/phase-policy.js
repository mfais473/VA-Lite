const FOLLOWUP_TOOLS = new Set([
  'pick_source', 'read_folder', 'view_last_image', 'view_screenshot',
  'read_pdf',
  'read_excel', 'edit_excel', 'create_excel',
]);

function choosePhase(run) {
  if (run.codingActive) return 'coding';
  if (run.hasImages) return 'followUp';
  if ((run.executed || []).some((name) => FOLLOWUP_TOOLS.has(name))) return 'followUp';
  return 'primary';
}

module.exports = { choosePhase, FOLLOWUP_TOOLS };
