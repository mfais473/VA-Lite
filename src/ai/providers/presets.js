const PRESETS = {
  claude: {
    id: 'claude', label: 'Claude (Anthropic)', protocol: 'anthropic',
    baseURL: 'https://api.anthropic.com', baseUrlEnv: 'ANTHROPIC_BASE_URL', keyEnv: 'ANTHROPIC_API_KEY',
    modelEnv: { primary: 'CLAUDE_MODEL_PRIMARY', followUp: 'CLAUDE_MODEL_FOLLOWUP', coding: 'CLAUDE_MODEL_CODING' },
    defaults: { primary: 'claude-sonnet-5-5', followUp: 'claude-sonnet-5-5', coding: 'claude-sonnet-5-5' },
    capabilities: { images: true, tools: true },
  },
  openai: {
    id: 'openai', label: 'OpenAI', protocol: 'openai',
    baseURL: 'https://api.openai.com/v1', baseUrlEnv: 'OPENAI_BASE_URL', keyEnv: 'OPENAI_API_KEY',
    modelEnv: { primary: 'OPENAI_MODEL_PRIMARY', followUp: 'OPENAI_MODEL_FOLLOWUP', coding: 'OPENAI_MODEL_CODING' },
    defaults: { primary: 'gpt-5.5', followUp: 'gpt-5.5', coding: 'gpt-5.5' },
    capabilities: { images: true, tools: true },
    tokenParam: 'max_completion_tokens',
  },
  deepseek: {
    id: 'deepseek', label: 'DeepSeek', protocol: 'openai',
    baseURL: 'https://api.deepseek.com', baseUrlEnv: 'DEEPSEEK_BASE_URL', keyEnv: 'DEEPSEEK_API_KEY',
    modelEnv: { primary: 'DEEPSEEK_MODEL_PRIMARY', followUp: 'DEEPSEEK_MODEL_FOLLOWUP', coding: 'DEEPSEEK_MODEL_CODING' },
    defaults: { primary: 'deepseek-flash', followUp: 'deepseek-flash', coding: 'deepseek-flash' },
    capabilities: { images: true, tools: true },
    extraBody: { thinking: { type: 'disabled' } },
  },
  gemini: {
    id: 'gemini', label: 'Gemini (Google)', protocol: 'gemini',
    baseURL: null, baseUrlEnv: null, keyEnv: 'GEMINI_API_KEY', host: 'generativelanguage.googleapis.com',
    modelEnv: { primary: 'GEMINI_MODEL_PRIMARY', followUp: 'GEMINI_MODEL_FOLLOWUP', coding: 'GEMINI_MODEL_CODING' },
    defaults: { primary: 'gemini-2.0-flash-lite', followUp: 'gemini-2.0-flash', coding: 'gemini-2.0-flash' },
    capabilities: { images: true, tools: true },
  },
  anoman: {
    id: 'anoman', label: 'Anoman', protocol: 'openai', legacy: true,
    baseURL: 'https://api.anoman.io/v1', baseUrlEnv: 'ANOMAN_BASE_URL', keyEnv: 'ANOMAN_API_KEY',
    modelEnv: { primary: 'ANOMAN_MODEL_PRIMARY', followUp: 'ANOMAN_MODEL_FOLLOWUP', coding: 'ANOMAN_MODEL_CODING' },
    defaults: { primary: 'gpt-4o-mini', followUp: 'gpt-4o-mini', coding: 'gpt-4o-mini' },
    capabilities: { images: true, tools: true },
  },
};

module.exports = { PRESETS };
