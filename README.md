# Apex Airways Agentic Control Center

An AI portfolio showcase demonstrating live multi-agent coordination on a real-world operations problem. Three distinct Gemini agents collaborate to process live weather and transit data and produce passenger travel alerts.

## Project Structure
- `index.html`: The minimal operations dashboard UI.
- `style.css`: Minimalist CSS styled to match modern light-mode portfolios.
- `js/app.js`: Client-side logic for rendering live data.
- `js/locations.js`: Helper functions and coordinates database for travel times.
- `scripts/run-pipeline.mjs`: Node.js script that runs the three-agent Gemini pipeline.
- `data/latest-run.json`: Output of the latest pipeline execution.
- `DESIGN.md`: The canonical system architecture and prompt specifications.

## Setup & Running the Pipeline

1. **Clone the repository:**
   ```bash
   git clone https://github.com/amardan/apex-airways-ops.git
   cd apex-airways-ops
   ```

2. **Add your Gemini API Key:**
   Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

3. **Run the pipeline:**
   ```bash
   npm run pipeline
   ```
   This will execute the agentic workflow, fetch weather, consult the DMV location database, prompt Gemini 2.5 Flash for the agent scenarios/logs/SMS drafts, and write the output to `data/latest-run.json`.
