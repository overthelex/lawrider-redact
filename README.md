# LawRider Redact

A Chrome extension that removes personal and client data from what you send to ChatGPT or Claude, and puts it back in the answer you read. Everything happens inside your browser. Nothing is sent anywhere else: no server, no telemetry, no remote code.

**Status: early development (v0.1).** Do not rely on it for client work yet.

## How it works
1. **Before you send:** names, companies, addresses, emails, phone numbers, postcodes, National Insurance numbers, bank details and company numbers are replaced with placeholders such as `[PERSON_1]` and `[COMPANY_2]`.
2. **The mapping stays in your browser.** The link between `[PERSON_1]` and the real name is kept in Chrome's session storage, which is cleared when you close the browser.
3. **When the answer arrives:** the side panel shows it with the real names restored. The AI service only ever saw placeholders.
4. **Documents:** drop a PDF or Word file into the side panel. Its text is extracted locally, anonymised and inserted into the chat. Uploading a file directly to the chat is intercepted with a warning.

Detection combines fixed patterns for UK identifiers, a small named-entity model that runs locally (bundled with the extension, no download), and your own list of terms to always mask, such as client and matter names. Dates and references to legislation are deliberately left alone: they are what a legal question is about.

## Why a browser extension
- **Nothing to install** beyond the extension, and no admin rights.
- **Fully auditable:** this repository is the whole of the code. Chrome's Manifest V3 forbids extensions from loading code from the internet.
- **Firm-wide deployment** works through Chrome's `ExtensionSettings` policy (force install).

## Limits
- Covers chatgpt.com and claude.ai in Chrome only. It does **not** protect the desktop or mobile apps, other browsers, or connectors to cloud drives.
- Scanned PDFs without a text layer cannot be read.
- Automatic detection is not perfect. Always review the list of masked items in the side panel before sending.

## Development
```
npm install
npm run fetch-model   # downloads dslim/distilbert-NER (Apache-2.0) and quantises it to int8 (needs python3 + onnxruntime)
npm test              # unit tests (the real-model test runs when the model is present)
npm run build         # builds the unpacked extension into dist/ (~95 MB with model and runtime)
CHROME_BIN=/path/to/chrome-for-testing npm run e2e   # loads dist/ in Chrome for Testing and checks: nothing leaks, no network requests
```

Licence: Apache-2.0. Made by [LawRider](https://lawrider.uk).

## Load it in Chrome (testing)
1. `npm run build`
2. Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked** and choose `dist/`.
3. Pin the extension and click its icon to open the side panel, then use ChatGPT or Claude as usual.
