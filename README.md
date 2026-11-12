# VA-Lite

![VA-Lite Logo](assets/logo.png)

A desktop assistant shaped like a **floating logo bubble** on your screen. Click
the bubble, then type commands or questions into the chat panel. VA-Lite replies
with text and can run tools on your computer (open a browser, read PDFs, Excel
files, edit projects, etc.) after you grant permission.

The app runs on Electron as a **transparent, frameless window** that always
stays on top of other windows. Input and output are entirely text-based.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure your API key

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Then open `.env` and configure your provider and API key:

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
```

Replace `your_key_here` with your actual Gemini API key.

### 3. Run the application

```bash
npm start
```

---

## License

- **Source code:** [Apache License 2.0](LICENSE)

---

## Credits

- [Google Gemini API](https://ai.google.dev/)
- [Anoman](https://www.anoman.io/) — used in this project.
