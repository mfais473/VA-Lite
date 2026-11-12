const openBrowser = require('./open-browser');
const findFiles = require('./find-files');
const screenshot = require('./screenshot');
const viewScreenshot = require('./view-screenshot');
const viewLastImage = require('./view-last-image');
const readPdf = require('./read-pdf');
const pickSource = require('./pick-source');
const readFolder = require('./read-folder');
const createExcel = require('./create-excel');
const readExcel = require('./read-excel');
const editExcel = require('./edit-excel');
const createWord = require('./create-word');
const readWord = require('./read-word');
const editWord = require('./edit-word');
const projectList = require('./project-list');
const projectReadFile = require('./project-read-file');
const projectReadLog = require('./project-read-log');
const applyPatch = require('./apply-patch');
const projectProposePlan = require('./project-propose-plan');
const projectSearch = require('./project-search');
const projectRunCheck = require('./project-run-check');
const { REASON_KEY, REASON_DESCRIPTION } = require('./reason');

const TOOLS = {
  [openBrowser.name]: openBrowser,
  [findFiles.name]: findFiles,
  [screenshot.name]: screenshot,
  [viewScreenshot.name]: viewScreenshot,
  [readPdf.name]: readPdf,
  [pickSource.name]: pickSource,
  [readFolder.name]: readFolder,
  [viewLastImage.name]: viewLastImage,
  [createExcel.name]: createExcel,
  [readExcel.name]: readExcel,
  [editExcel.name]: editExcel,
  [createWord.name]: createWord,
  [readWord.name]: readWord,
  [editWord.name]: editWord,
  [projectList.name]: projectList,
  [projectReadFile.name]: projectReadFile,
  [projectReadLog.name]: projectReadLog,
  [applyPatch.name]: applyPatch,
  [projectProposePlan.name]: projectProposePlan,
  [projectSearch.name]: projectSearch,
  [projectRunCheck.name]: projectRunCheck,
};

function getTool(name) {
  return Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null;
}

function getToolSchemas() {
  return Object.values(TOOLS).map((t) => {
    const properties = {};
    const required = [];
    for (const [k, v] of Object.entries(t.params || {})) {
      properties[k] = { type: v.type || 'string', description: v.description || '' };
      if (v.required) required.push(k);
    }
    properties[REASON_KEY] = { type: 'string', description: REASON_DESCRIPTION };
    required.push(REASON_KEY);
    return {
      name: t.name,
      description: t.description,
      parameters: { type: 'object', properties, required },
    };
  });
}

module.exports = { TOOLS, getTool, getToolSchemas };
