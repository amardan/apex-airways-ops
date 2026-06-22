import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dmvLocations, calculateTravelTime } from '../js/locations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from root .env if it exists
try {
  // Support both stand-alone repo structure and main portfolio subproject structure
  let envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) {
    envPath = path.resolve(__dirname, '../../../.env');
  }

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
        process.env[key] = value;
      }
    });
  }
} catch (e) {
  console.log('No local .env file found, using system environment variables.');
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Destination list
const DESTINATIONS = {
  "ORD": { name: "Chicago O'Hare", base_status: "Normal" },
  "LHR": { name: "London Heathrow", base_status: "Normal" },
  "LAX": { name: "Los Angeles", base_status: "Normal" },
  "MIA": { name: "Miami", base_status: "Normal" },
  "JFK": { name: "New York JFK", base_status: "Normal" },
  "AUA": { name: "Aruba", base_status: "Normal" }
};

const CITY_COORDS = {
  "Dulles": { lat: 38.9531, lon: -77.4565 },
  "Chicago O'Hare": { lat: 41.9742, lon: -87.9073 },
  "London Heathrow": { lat: 51.4700, lon: -0.4543 },
  "Los Angeles": { lat: 33.9416, lon: -118.4085 },
  "Miami": { lat: 25.7959, lon: -80.2870 },
  "New York JFK": { lat: 40.6413, lon: -73.7781 },
  "Aruba": { lat: 12.5014, lon: -70.0152 }
};

function mapWmoCode(code) {
  if (code === 0) return "Clear";
  if (code >= 1 && code <= 3) return "Partly Cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain Showers";
  if (code === 85 || code === 86) return "Snow Showers";
  if (code >= 95) return "Thunderstorm";
  return "Clear";
}

// ─── TIME UTILITIES ───────────────────────────────────────────────────────────

/**
 * Round a Date object to the nearest 5-minute boundary.
 * Airlines schedule at :00 :05 :10 :15 :20 :25 :30 :35 :40 :45 :50 :55.
 */
function roundToNearest5Min(date) {
  const ms = date.getTime();
  const fiveMin = 5 * 60 * 1000;
  return new Date(Math.round(ms / fiveMin) * fiveMin);
}

/**
 * Add minutes to a Date and return a new Date.
 */
function addMinutes(date, mins) {
  return new Date(date.getTime() + mins * 60 * 1000);
}

/**
 * Subtract minutes from a Date and return a new Date.
 */
function subtractMinutes(date, mins) {
  return new Date(date.getTime() - mins * 60 * 1000);
}

/**
 * Format a Date as 12-hour ET time string, e.g. "10:35 PM".
 */
function formatET(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

// Fetch live weather from Open-Meteo (100% free, keyless, global API)
async function fetchWeather(city) {
  const coords = CITY_COORDS[city];
  if (!coords) {
    throw new Error(`Unknown city ${city}`);
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&timezone=America%2FNew_York&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=2`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo API returned status: ${response.status} for city ${city}`);
  }
  const data = await response.json();
  
  const forecastArray = [];
  
  if (data.hourly && data.hourly.time) {
    // Find the current time in America/New_York formatted as YYYY-MM-DDTHH:00 to match Open-Meteo's format
    const now = new Date();
    const nyParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false
    }).formatToParts(now);
    
    const month = nyParts.find(p => p.type === 'month').value;
    const day = nyParts.find(p => p.type === 'day').value;
    const year = nyParts.find(p => p.type === 'year').value;
    let hourVal = nyParts.find(p => p.type === 'hour').value;
    if (hourVal === '24') {
      hourVal = '00';
    }
    const currentNyString = `${year}-${month}-${day}T${hourVal}:00`;
    
    let closestIdx = data.hourly.time.indexOf(currentNyString);
    if (closestIdx === -1) {
      // Fallback: extract local hour number and use it directly as the index
      const localHourStr = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        hour12: false
      }).format(now);
      closestIdx = parseInt(localHourStr, 10);
    }
    
    for (let offset = 1; offset <= 5; offset++) {
      // Since we fetch 2 days (48 hours), currentIdx + offset is guaranteed to be in range
      const idx = (closestIdx + offset) % data.hourly.time.length;
      const timeStr = data.hourly.time[idx]; // e.g. "2026-06-18T23:00"
      
      // Timezone independent parser: extract the hour from "YYYY-MM-DDTHH:MM" directly
      const hourPart = timeStr.split('T')[1].split(':')[0];
      const hourNum = parseInt(hourPart, 10);
      const ampm = hourNum >= 12 ? 'PM' : 'AM';
      const displayHour = hourNum % 12 === 0 ? 12 : hourNum % 12;
      const displayTime = `${displayHour} ${ampm}`;
      
      forecastArray.push({
        time: displayTime,
        temp: Math.round(data.hourly.temperature_2m[idx]),
        condition: mapWmoCode(data.hourly.weather_code[idx])
      });
    }
  }

  return {
    temp: Math.round(data.current.temperature_2m),
    condition: mapWmoCode(data.current.weather_code),
    humidity: data.current.relative_humidity_2m,
    wind_mph: Math.round(data.current.wind_speed_10m),
    forecast: forecastArray
  };
}

// Main execution function
async function main() {
  const timestamp = new Date().toISOString();
  console.log(`Starting Apex Airways Operations pipeline run at ${timestamp}...`);

  // 1. Fetch real weather for Dulles (IAD) and destinations
  const iadWeather = await fetchWeather('Dulles');
  console.log(`Dulles (IAD) Weather: ${iadWeather.condition}, ${iadWeather.temp}F, ${iadWeather.wind_mph}mph winds.`);

  const destEntries = Object.entries(DESTINATIONS);
  const destWeatherMap = {};
  const destWeathers = await Promise.all(destEntries.map(([, dest]) => fetchWeather(dest.name)));
  destEntries.forEach(([code], i) => { destWeatherMap[code] = destWeathers[i]; });

  // Compile full destinations status block
  const destStatusBlock = {};
  for (const [code, info] of Object.entries(DESTINATIONS)) {
    const dWeather = destWeatherMap[code];
    let status = "Normal";
    if (dWeather.condition.toLowerCase().includes("storm") || dWeather.condition.toLowerCase().includes("heavy")) {
      status = "Major Delays";
    } else if (dWeather.condition.toLowerCase().includes("rain") || dWeather.condition.toLowerCase().includes("snow") || dWeather.condition.toLowerCase().includes("fog")) {
      status = "Minor Delays";
    }
    destStatusBlock[code] = {
      name: info.name,
      weather: dWeather.condition,
      temp: dWeather.temp,
      status: status
    };
  }

  // Get current local time as a real Date object (used for all arithmetic)
  const now = new Date();

  // Format current local time in ET for display
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  const currentLocalTimeStr = formatter.format(now);

  // Parse decimal hour in ET (for rush hour detection)
  const etHourString = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }).format(now);
  const [etHour, etMinute] = etHourString.split(':').map(Number);
  const currentHourDecimal = etHour + etMinute / 60;

  let outputData = {
    timestamp: timestamp,
    disruption_level: "LOW",
    iad_weather: iadWeather,
    destinations: destStatusBlock,
    passengers: []
  };

  // Determine global disruption level based on IAD weather
  if (iadWeather.condition.toLowerCase().includes("storm") || iadWeather.condition.toLowerCase().includes("heavy") || iadWeather.condition.toLowerCase().includes("snow")) {
    outputData.disruption_level = "HIGH";
  } else if (iadWeather.condition.toLowerCase().includes("rain") || iadWeather.condition.toLowerCase().includes("mist") || iadWeather.condition.toLowerCase().includes("fog")) {
    outputData.disruption_level = "MEDIUM";
  }

  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not defined. The pipeline requires a valid API key to run.");
  }

  console.log("GEMINI_API_KEY found. Running Creator Agent & Decision Committee...");
  try {
      // ── AGENT 1: Scenario Generator ──────────────────────────────────────────
      const prompt1 = `
You are the Scenario Generator Agent (Agent 1) for the Apex Airways Agentic Control Center at Dulles International Airport (IAD).
Current Time: ${currentLocalTimeStr} Eastern Time

You are the WRITER. Your only job is creative world-building. Generate exactly 1 fictional passenger group with a compelling narrative. You have ZERO access to weather data, travel times, schedules, or flight logistics — those are handled by the system engine after you respond.

For this passenger group, generate:
1. "name": A realistic fictional name (e.g. "Amara & Kwame Asante", "Dr. Priya Nair", "The Okonkwo Family").
2. "size": Party size as an integer between 1 and 6 inclusive.
3. "details": A richly specific 2-3 sentence narrative. Weave together: who they are, where they're coming from, where they're going, and why. Mention companions, occupation, or occasion where it adds life. ABSOLUTE PROHIBITION: Do NOT mention travel time, drive minutes, hours to airport, departure schedule, or any logistics. ONLY describe who they are and why they travel.
4. "origin": Starting neighborhood key. Choose EXACTLY one key from this list:
${Object.entries(dmvLocations).map(([key, val]) => `   - "${key}": ${val.name} (${val.county} County)`).join('\n')}
5. "transit": Exactly 'Drive', 'Rideshare', or 'Metro'.
   - leesburg, chantilly, sterling have NO Metro — MUST use 'Drive' or 'Rideshare'.
6. "destination_code": One of ORD, LAX, MIA, JFK (domestic) or LHR, AUA (international). Vary your pick across runs — do not default to the same destination repeatedly.
7. "hours_to_departure": Decimal strictly between 3.1 and 5.9 (e.g. 3.75, 4.20, 5.50). Up to 2 decimal places.

DIVERSITY DIRECTIVE — across pipeline runs, vary ALL of these:
- Nationality and cultural background of the passenger group
- Occupation or life stage (student, retiree, professional, family, couple, solo traveler)
- Purpose of travel (vacation, business, medical, reunion, competition, honeymoon, relocation)
- Origin neighborhood (rotate across the full DMV registry)
- Transit mode (rotate Drive, Rideshare, Metro where valid)
- Destination (do not repeat the same airport twice in a row)

Return ONLY a valid JSON object. No markdown, no backticks, no explanation.
{
  "passengers": [
    {
      "name": "Name",
      "size": 2,
      "details": "Narrative story text.",
      "origin": "location_key",
      "transit": "Drive",
      "destination_code": "LHR",
      "hours_to_departure": 4.5
    }
  ]
}
`;

      console.log("Calling Agent 1 (Scenario Generator)...");
      const res1 = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt1 }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      if (!res1.ok) {
        throw new Error(`Gemini API Agent 1 returned status: ${res1.status}`);
      }
      const data1 = await res1.json();
      const candidate1 = data1?.candidates?.[0];
      if (!candidate1?.content?.parts?.[0]?.text) {
        throw new Error(`Agent 1 returned no usable content. Finish reason: ${candidate1?.finishReason || 'unknown'}`);
      }
      const text1 = candidate1.content.parts[0].text;
      const aiScenarios = JSON.parse(text1.trim());

      // ── SERVER-SIDE DETERMINISTIC CALCULATIONS ────────────────────────────────
      // All time arithmetic and travel calculations happen here in Node.js — NOT in the LLM.
      // This guarantees 5-minute-rounded times and eliminates hallucinated math.
      console.log("Running deterministic server-side calculations...");
      const calculatedPassengers = [];

      for (let i = 0; i < aiScenarios.passengers.length; i++) {
        const rawP = aiScenarios.passengers[i];
        rawP.id = `PX-20${i}`;

        const originLoc = dmvLocations[rawP.origin];
        if (!originLoc) {
          throw new Error(`Agent 1 returned an invalid origin key: "${rawP.origin}". Must be one of: ${Object.keys(dmvLocations).join(', ')}`);
        }

        // Server-side transit restriction enforcement
        const NO_METRO_ORIGINS = ['leesburg', 'chantilly', 'sterling'];
        if (rawP.transit === 'Metro' && NO_METRO_ORIGINS.includes(rawP.origin)) {
          console.warn(`Agent 1 assigned Metro to ${rawP.origin} which has no Metro access. Overriding to 'Drive'.`);
          rawP.transit = 'Drive';
        }
        const destStatus = destStatusBlock[rawP.destination_code] || { status: "Normal" };
        const isInternational = rawP.destination_code === 'LHR' || rawP.destination_code === 'AUA';

        // ── TRAVEL TIME: computed deterministically via calculateTravelTime() ──
        const travelResult = calculateTravelTime(
          rawP.origin,
          rawP.transit,
          currentHourDecimal,
          iadWeather.condition
        );
        const calculatedTravelMins = travelResult.duration;
        const travelBreakdown = travelResult.breakdown;
        const baseTravelMins = travelResult.baseDuration;

        // ── DEPARTURE TIME: snap to nearest 5-minute boundary ─────────────────
        // hours_to_departure from Agent 1 is an arbitrary decimal.
        // We add it to now, then snap to the nearest :00/:05/..:55 mark.
        // This ensures flight times look like real airline schedules.
        const rawDepartureDate = addMinutes(now, rawP.hours_to_departure * 60);
        const departureDate = roundToNearest5Min(rawDepartureDate);
        const departureTimeStr = formatET(departureDate);

        // ── BUFFERS ───────────────────────────────────────────────────────────
        // International (LHR, AUA): 180 min base. Domestic: 120 min base.
        // Groups > 2 get an extra +15 min buffer.
        const baseBuffer = isInternational ? 180 : 120;
        const groupBuffer = rawP.size > 2 ? 15 : 0;
        const totalBuffer = baseBuffer + groupBuffer;

        // ── SCHEDULE TIMES: all computed in JS, all rounded to 5 min ─────────
        const requiredArrivalDate  = roundToNearest5Min(subtractMinutes(departureDate, totalBuffer));
        const mustLeaveHomeDate    = roundToNearest5Min(subtractMinutes(requiredArrivalDate, calculatedTravelMins));
        const scheduledSendDate    = roundToNearest5Min(subtractMinutes(mustLeaveHomeDate, 30));

        const requiredArrivalStr   = formatET(requiredArrivalDate);
        const mustLeaveHomeStr     = formatET(mustLeaveHomeDate);
        const scheduledSendStr     = formatET(scheduledSendDate);

        // ── STATUS DETERMINATION ──────────────────────────────────────────────
        // "ACTION REQUIRED" if: send time is at or past now, OR major delays at destination.
        const nowMs = now.getTime();
        const sendTimeMs = scheduledSendDate.getTime();
        const mustLeaveMs = mustLeaveHomeDate.getTime();
        const isTimeCritical = sendTimeMs <= nowMs || (mustLeaveMs - nowMs) <= 30 * 60 * 1000;
        const isMajorDelay = destStatus.status === "Major Delays";
        const status = (isTimeCritical || isMajorDelay) ? "ACTION REQUIRED" : "PASS / WAIT";

        // ── DECISION CONDITIONS SUMMARY ───────────────────────────────────────
        const conditionParts = [];
        const cond = iadWeather.condition.toLowerCase();
        const isRushHour = (currentHourDecimal >= 7.5 && currentHourDecimal <= 9.5) ||
                           (currentHourDecimal >= 16.0 && currentHourDecimal <= 19.0);

        if (rawP.transit === 'Metro') {
          // Metro is weather-immune for most conditions, but storms/snow add a small delay
          if (cond.includes("snow") || cond.includes("blizzard")) conditionParts.push("snow conditions (+30% Metro)");
          else if (cond.includes("storm") || cond.includes("thunderstorm") || cond.includes("heavy")) conditionParts.push("storm conditions (+15% Metro)");
          else if (cond.includes("rain") || cond.includes("drizzle") || cond.includes("mist")) conditionParts.push("rainy weather (+5% Metro)");
        } else {
          if (isRushHour) conditionParts.push("rush hour traffic (+40%)");
          if (cond.includes("snow") || cond.includes("blizzard")) conditionParts.push("snow conditions (+80% Drive)");
          else if (cond.includes("storm") || cond.includes("thunderstorm") || cond.includes("heavy")) conditionParts.push("storm conditions (+45% Drive)");
          else if (cond.includes("rain") || cond.includes("drizzle") || cond.includes("mist")) conditionParts.push("rainy weather (+20% Drive)");
          if (originLoc.bridge_crossing && isRushHour) conditionParts.push("American Legion Bridge delay");
          if (rawP.transit === 'Rideshare' && (cond.includes("rain") || cond.includes("snow") || cond.includes("storm") || cond.includes("drizzle") || cond.includes("mist"))) {
            conditionParts.push("rideshare surge (+10m)");
          }
        }
        if (isMajorDelay) conditionParts.push(`major delays at ${rawP.destination_code}`);
        const decisionConditions = conditionParts.length > 0 ? conditionParts.join(", ") : "weather clear and no rush hour";

        // ── URGENCY TIER (computed in Node.js — passed to Agent 3 so it never parses time strings) ──
        // CRITICAL: time-urgent (send time at/past now or must-leave within 30 min)
        // HOLD: major delays at destination (passenger should not rush for a delayed flight)
        // CRITICAL_HOLD: both time-critical AND major delays — still a HOLD (never rush for delays) but
        //                flagged so Agent 2's ops_summary can note the time conflict
        // STANDBY: enough time, no major issues
        let urgencyTier;
        if (isMajorDelay && isTimeCritical) {
          // Do NOT rush the passenger toward a flight with major delays — HOLD takes priority.
          // However, flag the situation so the ops log can note the time conflict.
          urgencyTier = 'HOLD';
        } else if (isMajorDelay) {
          urgencyTier = 'HOLD';
        } else if (isTimeCritical) {
          urgencyTier = 'CRITICAL';
        } else {
          urgencyTier = 'STANDBY';
        }

        const calcP = {
          id: rawP.id,
          name: rawP.name,
          size: rawP.size,
          details: rawP.details,
          origin: rawP.origin,
          origin_name: originLoc.name,
          transit: rawP.transit,
          destination_code: rawP.destination_code,
          destination_name: DESTINATIONS[rawP.destination_code]?.name || rawP.destination_code,
          destination_status: destStatus.status,
          departure_time: departureTimeStr,
          hours_to_departure: parseFloat(parseFloat(rawP.hours_to_departure).toFixed(2)),
          is_international: isInternational,
          base_travel_mins: baseTravelMins,
          calculated_travel_mins: calculatedTravelMins,
          travel_breakdown: travelBreakdown,
          required_airport_arrival: requiredArrivalStr,
          must_leave_home: mustLeaveHomeStr,
          scheduled_send_time: scheduledSendStr,
          status: status,
          urgency_tier: urgencyTier,
          decision_conditions: decisionConditions
        };
        calculatedPassengers.push(calcP);
      }

      // ── AGENT 2: Operational Analyzer ────────────────────────────────────────
      // Agent 2 is the ENGINEER. Its sole job: write a tight ops log entry.
      // All math is already done. It receives only what it needs — nothing more.
      console.log("Calling Agent 2 (Operational Analyzer)...");

      // Agent 2 receives a minimal trimmed payload — only the fields needed for narrative writing
      const agent2Payload = calculatedPassengers.map(p => ({
        id: p.id,
        name: p.name,
        transit: p.transit,
        destination_name: p.destination_name,
        calculated_travel_mins: p.calculated_travel_mins,
        must_leave_home: p.must_leave_home,
        status: p.status,
        urgency_tier: p.urgency_tier,
        decision_conditions: p.decision_conditions
      }));

      const promptForAgent2 = `
You are the Operational Analyzer Agent (Agent 2) for the Apex Airways Agentic Control Center at Dulles International Airport (IAD).
Current Time: ${currentLocalTimeStr} Eastern Time

You are the ENGINEER. Your only job is to write a strict ops log entry. All travel times, schedule deadlines, and status determinations have already been computed by the Apex deterministic engine and are authoritative — do NOT question, recalculate, or modify any figures.

Pre-computed operational report:
${JSON.stringify(agent2Payload, null, 2)}

YOUR ONLY TASK:
For each passenger, write a concise 2–3 sentence "ops_summary" that reads like an operations log entry:
- Sentence 1: State the transit mode, the travel time to Dulles Airport (IAD) in minutes, and the passenger's destination.
- Sentence 2: State what conditions are active (from decision_conditions field) and what status was determined (from status field).
- Sentence 3 (optional): Add any operationally relevant note if urgency_tier is HOLD or CRITICAL.

STRICT RULES:
- Use factual, present-tense language. No friendly tone, no filler words.
- Do NOT mention travel time to the destination city. Only travel time to Dulles Airport (IAD).
- Do NOT recalculate, invent, or modify any figures. Use the data verbatim.
- Do NOT include recommendations for the passenger — that is Agent 3's job.
- Keep it under 60 words total per passenger.

Return ONLY a valid JSON object. No markdown, no backticks.
{
  "passengers": [
    {
      "id": "PX-200",
      "ops_summary": "Ops log entry here."
    }
  ]
}
`;

      const resOpt = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptForAgent2 }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      if (!resOpt.ok) {
        throw new Error(`Gemini API Agent 2 returned status: ${resOpt.status}`);
      }
      const dataOpt = await resOpt.json();
      const candidateOpt = dataOpt?.candidates?.[0];
      if (!candidateOpt?.content?.parts?.[0]?.text) {
        throw new Error(`Agent 2 returned no usable content. Finish reason: ${candidateOpt?.finishReason || 'unknown'}`);
      }
      const textOpt = candidateOpt.content.parts[0].text;
      const agent2Out = JSON.parse(textOpt.trim());

      // Merge Agent 2 ops summaries back into calculatedPassengers
      for (const p of calculatedPassengers) {
        const matched = agent2Out?.passengers?.find(x => x.id === p.id);
        if (matched?.ops_summary) {
          p.ops_summary = matched.ops_summary;
        }
      }

      // ── AGENT 3: CX Outreach Director ─────────────────────────────────────────
      // Agent 3 is the COMMUNICATOR. It receives a trimmed payload and writes one ≤160-char SMS.
      // Tone is determined solely by urgency_tier — three dramatically different voices.
      const agent3Payload = calculatedPassengers.map(p => ({
        id: p.id,
        name: p.name,
        transit: p.transit,
        destination_name: p.destination_name,
        destination_code: p.destination_code,
        destination_status: p.destination_status,
        calculated_travel_mins: p.calculated_travel_mins,
        must_leave_home: p.must_leave_home,
        departure_time: p.departure_time,
        urgency_tier: p.urgency_tier,
        decision_conditions: p.decision_conditions
      }));

      const prompt3 = `
You are the CX Outreach Director (Agent 3) for the Apex Airways Agentic Control Center at Dulles International Airport (IAD).
Current Time: ${currentLocalTimeStr} Eastern Time

You are the COMMUNICATOR. Your only job is to write one SMS message per passenger. All times and figures are pre-computed and final — do NOT recalculate, modify, or question any of them.

Operational report:
${JSON.stringify(agent3Payload, null, 2)}

━━━ HARD RULES ━━━
1. MAXIMUM 160 CHARACTERS per message. Count every character. This is a hard limit — not a suggestion.
2. Use the passenger's first name only (e.g. "Elena", not "The Rodriguez Family").
3. calculated_travel_mins = time from HOME to Dulles Airport (IAD). It is NOT a flight duration. Do not confuse them.
4. Never invent data. Use only what is in the report.
5. No URLs, no hashtags, no generic sign-offs (no "Safe travels!", "Have a great trip!", "Wishing you well").

━━━ URGENCY TIER — PICK ONE TONE PER PASSENGER ━━━

urgency_tier: "CRITICAL" — Passenger is overdue or must leave within 30 minutes.
  Lead EXACTLY with: "⚠️ APEX ALERT, [FirstName]."
  Include: must leave NOW, transit mode, calculated_travel_mins mins to IAD, and the reason from decision_conditions.
  Tone: urgent, terse, no softening. Every word earns its place.
  Example length target: under 140 characters.

urgency_tier: "HOLD" — Major delays at the destination. Do NOT encourage travel.
  Lead EXACTLY with: "✋ APEX HOLD, [FirstName]."
  Include: do NOT leave yet, name the destination, state the delay reason.
  Tone: firm, calm, clear. No travel time needed (they shouldn't go yet).
  Example length target: under 130 characters.

urgency_tier: "STANDBY" — Normal ops, time to spare.
  Lead EXACTLY with: "✈️ Apex, [FirstName]."
  Include: must_leave_home time, transit mode, calculated_travel_mins mins to IAD, condition note if any.
  Tone: calm, friendly, informative.
  Example length target: under 160 characters.

Return ONLY a valid JSON object. No markdown, no backticks.
{
  "passengers": [
    {
      "id": "PX-200",
      "message_draft": "SMS text here (≤160 chars)."
    }
  ]
}
`;

      console.log("Calling Agent 3 (CX Outreach Director)...");
      const res3 = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt3 }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      if (!res3.ok) {
        throw new Error(`Gemini API Agent 3 returned status: ${res3.status}`);
      }
      const data3 = await res3.json();
      const candidate3 = data3?.candidates?.[0];
      if (!candidate3?.content?.parts?.[0]?.text) {
        throw new Error(`Agent 3 returned no usable content. Finish reason: ${candidate3?.finishReason || 'unknown'}`);
      }
      const text3 = candidate3.content.parts[0].text;
      const aiOutbox = JSON.parse(text3.trim());

      // Merge Agent 3 message drafts back
      for (const p of calculatedPassengers) {
        const matched = aiOutbox?.passengers?.find(x => x.id === p.id);
        if (matched?.message_draft) {
          p.message_draft = matched.message_draft;
        } else {
          throw new Error(`Agent 3 failed to generate a message draft for passenger: ${p.name} (${p.id})`);
        }
        // Remove thoughts array to prevent rendering outdated visual containers
        delete p.agent_thoughts;
      }

      outputData.passengers = calculatedPassengers;
      console.log("Pipeline complete — all agents executed successfully.");

      // Write outputs to build data directory
      const dataDir = path.resolve(__dirname, '../data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const outputPath = path.join(dataDir, 'latest-run.json');
      fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
      console.log(`Successfully wrote operations data to: ${outputPath}`);

      // ── VALIDATION LOG ────────────────────────────────────────────────────────
      console.log("\n── Output Validation ────────────────────────────");
      for (const p of calculatedPassengers) {
        const dep = p.departure_time;
        const min = dep.match(/:(\d{2})/)?.[1];
        const isRounded = min && parseInt(min) % 5 === 0;
        console.log(`  ${p.name}: Dep=${dep} [${isRounded ? '✓ 5-min rounded' : '✗ NOT ROUNDED'}] Travel=${p.calculated_travel_mins}m Status=${p.status}`);
      }
      console.log("─────────────────────────────────────────────────\n");

    } catch (err) {
      console.error(`Error during pipeline execution: ${err.message}`);
      process.exit(1);
    }
}

main().catch(err => {
  console.error("Critical error in main pipeline:", err);
  process.exit(1);
});
