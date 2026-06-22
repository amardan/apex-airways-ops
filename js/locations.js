// DMV Location Database & Travel Time Calculator for Apex Airways
export const dmvLocations = {
  // LOUDOUN COUNTY (Local to Dulles)
  "ashburn": {
    name: "Ashburn, VA",
    county: "Loudoun",
    distance_miles: 10,
    base_drive_mins: 15,
    base_metro_mins: 25,
    metro_direct: true,
    bridge_crossing: false
  },
  "leesburg": {
    name: "Leesburg, VA",
    county: "Loudoun",
    distance_miles: 15,
    base_drive_mins: 22,
    base_metro_mins: 50,
    metro_direct: false,
    bridge_crossing: false
  },
  "sterling": {
    name: "Sterling, VA",
    county: "Loudoun",
    distance_miles: 7,
    base_drive_mins: 12,
    base_metro_mins: 25,
    metro_direct: false,
    bridge_crossing: false
  },

  // FAIRFAX COUNTY
  "reston": {
    name: "Reston, VA",
    county: "Fairfax",
    distance_miles: 7,
    base_drive_mins: 12,
    base_metro_mins: 12,
    metro_direct: true,
    bridge_crossing: false
  },
  "herndon": {
    name: "Herndon, VA",
    county: "Fairfax",
    distance_miles: 5,
    base_drive_mins: 10,
    base_metro_mins: 15,
    metro_direct: true,
    bridge_crossing: false
  },
  "vienna": {
    name: "Vienna, VA",
    county: "Fairfax",
    distance_miles: 15,
    base_drive_mins: 20,
    base_metro_mins: 40,
    metro_direct: false,
    bridge_crossing: false
  },
  "tysons": {
    name: "Tysons Corner, VA",
    county: "Fairfax",
    distance_miles: 14,
    base_drive_mins: 18,
    base_metro_mins: 30,
    metro_direct: true,
    bridge_crossing: false
  },
  "chantilly": {
    name: "Chantilly, VA",
    county: "Fairfax",
    distance_miles: 6,
    base_drive_mins: 10,
    base_metro_mins: 35,
    metro_direct: false,
    bridge_crossing: false
  },

  // ARLINGTON COUNTY
  "rosslyn": {
    name: "Rosslyn, VA",
    county: "Arlington",
    distance_miles: 25,
    base_drive_mins: 30,
    base_metro_mins: 50,
    metro_direct: true,
    bridge_crossing: false
  },
  "crystal_city": {
    name: "Crystal City, VA",
    county: "Arlington",
    distance_miles: 28,
    base_drive_mins: 35,
    base_metro_mins: 65,
    metro_direct: false,
    bridge_crossing: false
  },
  "ballston": {
    name: "Ballston, VA",
    county: "Arlington",
    distance_miles: 22,
    base_drive_mins: 26,
    base_metro_mins: 45,
    metro_direct: true,
    bridge_crossing: false
  },

  // WASHINGTON D.C.
  "dc_nw": {
    name: "Downtown / NW D.C.",
    county: "District of Columbia",
    distance_miles: 27,
    base_drive_mins: 38,
    base_metro_mins: 60,
    metro_direct: true,
    bridge_crossing: false
  },
  "dc_ne": {
    name: "Capitol Hill / NE D.C.",
    county: "District of Columbia",
    distance_miles: 31,
    base_drive_mins: 45,
    base_metro_mins: 70,
    metro_direct: false,
    bridge_crossing: false
  },
  "dc_sw": {
    name: "Waterfront / SW D.C.",
    county: "District of Columbia",
    distance_miles: 30,
    base_drive_mins: 40,
    base_metro_mins: 65,
    metro_direct: false,
    bridge_crossing: false
  },
  "dc_se": {
    name: "Anacostia / SE D.C.",
    county: "District of Columbia",
    distance_miles: 32,
    base_drive_mins: 48,
    base_metro_mins: 75,
    metro_direct: false,
    bridge_crossing: false
  },

  // MARYLAND
  "bethesda": {
    name: "Bethesda, MD",
    county: "Montgomery (MD)",
    distance_miles: 30,
    base_drive_mins: 35,
    base_metro_mins: 75,
    metro_direct: false,
    bridge_crossing: true
  },
  "silver_spring": {
    name: "Silver Spring, MD",
    county: "Montgomery (MD)",
    distance_miles: 33,
    base_drive_mins: 45,
    base_metro_mins: 85,
    metro_direct: false,
    bridge_crossing: true
  },
  "rockville": {
    name: "Rockville, MD",
    county: "Montgomery (MD)",
    distance_miles: 31,
    base_drive_mins: 38,
    base_metro_mins: 80,
    metro_direct: false,
    bridge_crossing: true
  }
};

export function calculateTravelTime(startKey, mode, currentHour, weatherCondition) {
  const loc = dmvLocations[startKey];
  if (!loc) return { duration: 30, baseDuration: 30, breakdown: "Default location used." };

  // Server-side transit validation: Metro not available for some locations.
  // If Agent 1 somehow returns Metro for a no-metro location, fall back to Drive.
  const effectiveMode = (mode === 'Metro' && !loc.metro_direct && loc.base_metro_mins === 0)
    ? 'Drive'
    : mode;

  const isDrive = effectiveMode === "Drive" || effectiveMode === "Rideshare";
  const baseDuration = isDrive ? loc.base_drive_mins : loc.base_metro_mins;
  let breakdown = `Base ${effectiveMode} time: ${baseDuration}m.`;

  // 1. Weather Multiplier (applied to base)
  let weatherMult = 1.0;
  const cond = (weatherCondition || "").toLowerCase();
  if (cond.includes("snow") || cond.includes("blizzard")) {
    weatherMult = isDrive ? 1.80 : 1.30;
    breakdown += ` Weather (Snow): +${isDrive ? '80' : '30'}% time.`;
  } else if (cond.includes("heavy") || cond.includes("storm") || cond.includes("thunderstorm")) {
    weatherMult = isDrive ? 1.45 : 1.15;
    breakdown += ` Weather (Storm): +${isDrive ? '45' : '15'}% time.`;
  } else if (cond.includes("rain") || cond.includes("drizzle") || cond.includes("mist")) {
    weatherMult = isDrive ? 1.20 : 1.05;
    breakdown += ` Weather (Rain): +${isDrive ? '20' : '5'}% time.`;
  }

  // 2. Rush Hour Multiplier (applied to base, independent of weather)
  const isRushHour =
    (currentHour >= 7.5 && currentHour <= 9.5) ||
    (currentHour >= 16.0 && currentHour <= 19.0);
  let rushMult = 1.0;
  if (isRushHour && isDrive) {
    rushMult = 1.40;
    breakdown += ` Rush Hour traffic: +40% drive time.`;
  }

  // Apply both multipliers to base simultaneously — correct compound math
  let duration = Math.round(baseDuration * weatherMult * rushMult);

  // 3. American Legion Bridge Crossing (Drive/Rideshare ONLY — Metro bypasses the bridge)
  if (loc.bridge_crossing && isDrive) {
    if (isRushHour && (cond.includes("rain") || cond.includes("storm") || cond.includes("snow") || cond.includes("mist"))) {
      const bridgeDelay = 35;
      duration += bridgeDelay;
      breakdown += ` American Legion Bridge Gridlock: +${bridgeDelay}m.`;
    } else if (isRushHour) {
      const bridgeDelay = 15;
      duration += bridgeDelay;
      breakdown += ` American Legion Bridge Rush Hour: +${bridgeDelay}m.`;
    }
  }

  // 4. Rideshare Surge (Rideshare ONLY — bad weather causes +10m flat surge delay)
  if (effectiveMode === "Rideshare" && weatherMult > 1.0) {
    const surgeMins = 10;
    duration += surgeMins;
    breakdown += ` Rideshare surge (bad weather): +${surgeMins}m.`;
  }

  return {
    duration: Math.max(duration, 5),
    baseDuration,
    breakdown
  };
}
