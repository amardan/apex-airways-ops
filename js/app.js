// App state
let currentRunData = null;

// Escape HTML characters to prevent XSS
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initialize Lucide Icons
function initIcons() {
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

// Show error state in the UI
function showErrorState(errorMsg) {
  // Update header update-ticker
  const updateTicker = document.getElementById('update-ticker');
  if (updateTicker) {
    updateTicker.innerHTML = `<span style="color: var(--accent-red); font-weight: 700;">Connection Failed</span>`;
  }

  // Update weather status bar
  const tempEl = document.getElementById('iad-weather-val');
  if (tempEl) tempEl.innerText = '--°F';

  const descEl = document.getElementById('iad-weather-desc');
  if (descEl) descEl.innerHTML = `<span style="color: var(--accent-red);">Offline | Telemetry unavailable</span>`;

  const forecastContainer = document.getElementById('iad-forecast-container');
  if (forecastContainer) {
    forecastContainer.innerHTML = `<div style="font-size: 0.75rem; color: var(--text-secondary); font-style: italic; padding: 0.5rem 0;">Forecast data offline</div>`;
  }

  // Update traveler-list-container
  const container = document.getElementById('traveler-list-container');
  if (container) {
    const safeErrorMsg = escapeHtml(errorMsg);

    container.innerHTML = `
      <div class="error-container" style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 3rem 1.5rem;
        background: rgba(255, 69, 58, 0.02);
        border: 1px dashed rgba(255, 69, 58, 0.3);
        border-radius: 16px;
        max-width: 580px;
        margin: 2rem auto;
      ">
        <i data-lucide="alert-triangle" style="width: 48px; height: 48px; color: var(--accent-red); margin-bottom: 1.25rem;"></i>
        <h3 style="font-size: 1.2rem; font-weight: 800; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: -0.01em; color: var(--text-primary);">
          Live Operations Offline
        </h3>
        <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 1.5rem; max-width: 460px;">
          The dashboard failed to fetch the latest agent execution results. This occurs when the automated three-agent Gemini pipeline is currently executing or if the backend storage is temporarily unreachable.
        </p>
        <div style="font-family: var(--font-mono); font-size: 0.75rem; background: rgba(0, 0, 0, 0.03); border: 1px solid var(--border); padding: 0.75rem 1rem; border-radius: 8px; color: var(--text-primary); text-align: left; width: 100%; word-break: break-all; margin-bottom: 1.5rem;">
          <span style="font-weight: 700; color: var(--text-secondary); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.25rem;">System Error Log:</span>
          ${safeErrorMsg}
        </div>
        <button id="retry-btn" class="control-btn" style="background-color: var(--accent-blue); border-color: var(--accent-blue); display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; padding: 0.45rem 1rem;">
          <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i>
          <span>Retry Connection</span>
        </button>
      </div>
    `;

    // Bind retry button listener
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        container.innerHTML = `
          <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
            Loading messaging board...
          </div>
        `;
        loadRunData();
      });
    }
  }

  // Refresh icons
  initIcons();
}

// Load pipeline run data from the latest GitHub Actions run output
async function loadRunData() {

  try {
    const response = await fetch(`./data/latest-run.json?t=${Date.now()}`);
    if (!response.ok) {
      throw new Error('Latest-run JSON not found or server returned error');
    }
    currentRunData = await response.json();
  } catch (e) {
    console.error(`Failed to load live data: ${e.message}`);
    showErrorState(e.message);
    return;
  }

  // Render Dashboard components
  renderTelemetry();
  renderTravelerBoard();
}

// Render Telemetry metrics
function renderTelemetry() {
  const data = currentRunData;
  if (!data) return;

  // Dulles weather card
  document.getElementById('iad-weather-val').innerText = `${data.iad_weather.temp}°F`;
  
  const descEl = document.getElementById('iad-weather-desc');
  if (descEl) {
    const levelColors = {
      LOW: 'var(--accent-green)',
      MEDIUM: 'var(--accent-yellow, orange)',
      HIGH: 'var(--accent-red)'
    };
    const level = data.disruption_level || 'LOW';
    const badgeColor = levelColors[level] || 'var(--accent-green)';
    descEl.innerHTML = `${escapeHtml(data.iad_weather.condition)} | Wind ${escapeHtml(data.iad_weather.wind_mph)} mph <span class="disruption-badge" style="display: inline-flex; align-items: center; margin-left: 0.75rem; padding: 0.1rem 0.4rem; font-size: 0.7rem; font-weight: 700; border-radius: 4px; background: rgba(0,0,0,0.04); border: 1px solid var(--border); color: ${badgeColor}; font-family: var(--font-mono); text-transform: uppercase;">Disruption: ${level}</span>`;
  }

  // Helper to map weather condition to a Lucide icon name
  const getWeatherIconName = (cond) => {
    const c = (cond || '').toLowerCase();
    if (c.includes('clear') || c.includes('sunny')) return 'sun';
    if (c.includes('partly')) return 'cloud-sun';
    if (c.includes('cloudy') || c.includes('fog')) return 'cloud';
    if (c.includes('drizzle') || c.includes('rain') || c.includes('shower')) return 'cloud-rain';
    if (c.includes('snow')) return 'snowflake';
    if (c.includes('storm') || c.includes('lightning')) return 'cloud-lightning';
    return 'cloud';
  };

  // Render 5-Hour Forecast
  const forecastContainer = document.getElementById('iad-forecast-container');
  if (forecastContainer) {
    forecastContainer.innerHTML = '';
    if (data.iad_weather.forecast && data.iad_weather.forecast.length > 0) {
      data.iad_weather.forecast.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'forecast-item';
        const safeTime = escapeHtml(item.time).replace(':00', '');
        const safeIcon = escapeHtml(getWeatherIconName(item.condition));
        const safeTemp = escapeHtml(item.temp);
        itemEl.innerHTML = `
          <span class="time">${safeTime}</span>
          <i data-lucide="${safeIcon}" class="forecast-icon"></i>
          <span class="temp">${safeTemp}°</span>
        `;
        forecastContainer.appendChild(itemEl);
      });
    }
  }


  // Last Update Ticker
  const dateObj = new Date(data.timestamp);
  document.getElementById('update-ticker').innerText = `Last Scan: ${dateObj.toLocaleTimeString()} (${dateObj.toLocaleDateString()})`;
}




// Render Traveler Dispatch Board
function renderTravelerBoard() {
  const data = currentRunData;
  const container = document.getElementById('traveler-list-container');
  if (!data || !container) return;

  container.innerHTML = '';

  // Get the single passenger scenario
  const p = data.passengers[0];
  if (!p) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
        <p style="font-size: 0.9rem;">No passengers dispatched this cycle.</p>
        <p style="font-size: 0.75rem; margin-top: 0.5rem;">Pipeline last ran at ${data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : 'unknown time'}.</p>
      </div>
    `;
    return;
  }

  // Verbose outputs representing exact agent payloads
  const agent1Verbose = {
    name: p.name,
    size: p.size,
    details: p.details,
    origin: p.origin,
    transit: p.transit,
    destination_code: p.destination_code,
    hours_to_departure: p.hours_to_departure
  };

  const agent2Verbose = {
    id: p.id,
    name: p.name,
    size: p.size,
    origin: p.origin,
    origin_name: p.origin_name,
    transit: p.transit,
    destination_code: p.destination_code,
    destination_name: p.destination_name,
    departure_time: p.departure_time,
    hours_to_departure: p.hours_to_departure,
    is_international: p.is_international,
    base_travel_mins: p.base_travel_mins,
    calculated_travel_mins: p.calculated_travel_mins,
    travel_breakdown: p.travel_breakdown,
    required_airport_arrival: p.required_airport_arrival,
    must_leave_home: p.must_leave_home,
    scheduled_send_time: p.scheduled_send_time,
    status: p.status,
    decision_conditions: p.decision_conditions
  };

  const agent3Verbose = {
    passengers: [
      {
        id: p.id,
        message_draft: p.message_draft
      }
    ]
  };

  // Urgency tier drives status badge independently of binary isAction
  const urgencyTier = p.urgency_tier || (p.status === 'ACTION REQUIRED' ? 'CRITICAL' : 'STANDBY');
  const isAction = p.status === 'ACTION REQUIRED';
  const row = document.createElement('div');
  row.className = `traveler-row ${isAction ? 'critical-row' : ''}`;
  row.setAttribute('data-id', p.id);

  // 1. Column 1 (Passenger Scenario)
  const badgeClass = urgencyTier === 'CRITICAL' ? 'action' : urgencyTier === 'HOLD' ? 'hold' : 'wait';
  const statusIcon = urgencyTier === 'CRITICAL' ? 'alert-triangle' : urgencyTier === 'HOLD' ? 'pause-circle' : 'clock';
  const statusLabel = urgencyTier === 'CRITICAL' ? 'Immediate Action' : urgencyTier === 'HOLD' ? 'Hold — Destination Delays' : 'Standby';

  const statusBadgeHtml = `
    <span class="passenger-badge ${badgeClass}" style="display: inline-flex; align-items: center; gap: 0.25rem;">
      <i data-lucide="${statusIcon}" style="width: 12px; height: 12px;"></i>
      <span>${statusLabel}</span>
    </span>
  `;

  const col1Html = `
    <div class="passenger-card" data-id="${escapeHtml(p.id)}">
      <div class="passenger-info">
        <div class="passenger-name-row">
          <span class="passenger-name">${escapeHtml(p.name)}</span>
          <span class="passenger-flight">Apex UA-${escapeHtml(p.destination_code)}</span>
        </div>
        <div class="passenger-details">
          ${escapeHtml(p.details)}
        </div>
        <div class="passenger-meta">
          <span class="passenger-badge">Party Size: ${escapeHtml(p.size)}</span>
          <span class="passenger-badge">Dep: ${escapeHtml(p.departure_time)}</span>
        </div>
        <details class="verbose-details">
          <summary class="verbose-summary">
            <i data-lucide="terminal"></i>
            <span>Agent 1 JSON Output</span>
          </summary>
          <pre class="verbose-pre">${escapeHtml(JSON.stringify(agent1Verbose, null, 2))}</pre>
        </details>
      </div>
    </div>
  `;

  // 2. Flow Arrow 1 -> 2
  const arrow1Html = `
    <div class="flow-arrow-container">
      <div class="flow-arrow">
        <i data-lucide="arrow-right" class="arrow-desktop"></i>
        <i data-lucide="arrow-down" class="arrow-mobile"></i>
      </div>
    </div>
  `;

  // 3. Column 2 (Operational Analyzer)
  const col2Html = `
    <div class="analysis-card" data-id="${escapeHtml(p.id)}">
      <div class="analysis-card-header">
        <span class="passenger-flight">Apex UA-${escapeHtml(p.destination_code)}</span>
        ${statusBadgeHtml}
      </div>
      <div class="analysis-grid">
        <div class="analysis-cell">
          <span class="label">Route:</span>
          <span class="value">${escapeHtml(p.origin_name)} to IAD</span>
        </div>
        <div class="analysis-cell">
          <span class="label">Transit:</span>
          <span class="value">${escapeHtml(p.transit)}</span>
        </div>
        <div class="analysis-cell">
          <span class="label">Time:</span>
          <span class="value font-mono">${escapeHtml(p.calculated_travel_mins)} mins</span>
        </div>
        <div class="analysis-cell">
          <span class="label">Leave Home:</span>
          <span class="value font-mono" style="font-weight: 700; color: ${isAction ? 'var(--accent-red)' : 'inherit'};">${escapeHtml(p.must_leave_home)}</span>
        </div>
      </div>
      <div class="mini-terminal">
        <div class="mini-terminal-line ops">Conditions: ${escapeHtml(p.decision_conditions || 'weather clear and no rush hour')}</div>
        ${p.ops_summary ? `<div class="mini-terminal-line ops" style="margin-top: 0.35rem; font-size: 0.72rem; color: var(--text-secondary); line-height: 1.4; font-style: italic;">${escapeHtml(p.ops_summary)}</div>` : ''}
        <div class="mini-terminal-line ops" style="margin-top: 0.25rem; font-size: 0.65rem; color: var(--text-secondary); opacity: 0.85;">${escapeHtml(p.travel_breakdown || '')}</div>
      </div>
      <details class="verbose-details">
        <summary class="verbose-summary">
          <i data-lucide="terminal"></i>
          <span>Node.js Pre-Computed Report</span>
        </summary>
        <pre class="verbose-pre">${escapeHtml(JSON.stringify(agent2Verbose, null, 2))}</pre>
      </details>
    </div>
  `;

  // 4. Flow Arrow 2 -> 3
  const arrow2Html = `
    <div class="flow-arrow-container">
      <div class="flow-arrow">
        <i data-lucide="arrow-right" class="arrow-desktop"></i>
        <i data-lucide="arrow-down" class="arrow-mobile"></i>
      </div>
    </div>
  `;

  // 5. Column 3 (CX Outreach Director)
  const messageBadgeClass = urgencyTier === 'CRITICAL' ? 'high' : urgencyTier === 'HOLD' ? 'hold' : 'normal';
  const messageStatusLabel = urgencyTier === 'CRITICAL' ? 'Sent' : urgencyTier === 'HOLD' ? 'On Hold' : `Scheduled (${p.scheduled_send_time ? escapeHtml(p.scheduled_send_time) : 'Pending'})`;

  const col3Html = `
    <div class="cx-card" data-id="${escapeHtml(p.id)}">
      <div class="cx-card-header">
        <span class="cx-phone">Outbox (SMS Preview)</span>
        <span class="status-badge ${messageBadgeClass}">${messageStatusLabel}</span>
      </div>
      <div class="cx-card-content" style="display: flex; flex-direction: column; gap: 0.6rem;">
        <span class="sms-type-label">${urgencyTier === 'CRITICAL' ? 'Text Message' : 'iMessage'}</span>
        <div class="sms-preview-bubble ${messageBadgeClass}">
          ${escapeHtml(p.message_draft || 'Preparing communication...')}
        </div>
        ${urgencyTier === 'CRITICAL' ? '<div class="sms-delivered-status">Delivered</div>' : ''}
        <details class="verbose-details">
          <summary class="verbose-summary">
            <i data-lucide="terminal"></i>
            <span>Agent 3 JSON Output</span>
          </summary>
          <pre class="verbose-pre">${escapeHtml(JSON.stringify(agent3Verbose, null, 2))}</pre>
        </details>
      </div>
    </div>
  `;

  row.innerHTML = col1Html + arrow1Html + col2Html + arrow2Html + col3Html;

  bindHoverEvents(row, p.id);
  container.appendChild(row);

  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

// Synchronized Hover Event Handler
function bindHoverEvents(rowElement, passengerId) {
  rowElement.addEventListener('mouseenter', () => {
    rowElement.classList.add('highlight-active');
    rowElement.querySelectorAll('.passenger-card, .analysis-card, .cx-card').forEach(el => {
      el.classList.add('highlight-active');
    });
  });

  rowElement.addEventListener('mouseleave', () => {
    rowElement.classList.remove('highlight-active');
    rowElement.querySelectorAll('.passenger-card, .analysis-card, .cx-card').forEach(el => {
      el.classList.remove('highlight-active');
    });
  });
}

// Tab Navigation
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');

      // Toggle active button
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Toggle active content
      tabContents.forEach(tc => {
        tc.classList.toggle('active', tc.id === `tab-${targetTab}`);
      });

      // Re-init icons for newly visible content
      initIcons();
    });
  });
}

function initLiveClock() {
  const clockEl = document.getElementById('live-clock');
  if (!clockEl) return;

  const updateClock = () => {
    const now = new Date();
    const etTimeString = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(now);
    clockEl.innerText = `Current Time (ET): ${etTimeString}`;
  };

  updateClock();
  setInterval(updateClock, 1000);
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initIcons();
  initTabs();
  initLiveClock();
  loadRunData();
});
