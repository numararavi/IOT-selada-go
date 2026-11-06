/**
 * Finite State Machine (FSM) evaluator for AUTO-SELADA.
 * Evaluates water parameters based on configured thresholds.
 *
 * States:
 * 1. NORMAL (pH 5.5 - 6.5 AND TDS 560 - 840)
 * 2. DANGER_LOW_TDS (TDS < 450)
 * 3. DANGER_HIGH_TDS (TDS > 950)
 * 4. DANGER_PH (pH < 5.0 OR pH > 7.0)
 * 5. SIAGA (pH 5.0 - 5.4 OR 6.6 - 7.0 OR TDS 450 - 559 OR 841 - 950)
 */
export function evaluateFSM(ph, tds, settings) {
  const phMin = settings?.ph_min ?? 5.5;
  const phMax = settings?.ph_max ?? 6.5;
  const tdsMin = settings?.tds_min ?? 560;
  const tdsMax = settings?.tds_max ?? 840;
  const tdsCritLow = settings?.tds_critical_low ?? 450;
  const tdsCritHigh = settings?.tds_critical_high ?? 950;

  // Check critical emergencies first
  if (tds < tdsCritLow) {
    return {
      state: 'DANGER_LOW_TDS',
      theme: '#ef4444',
      badge: 'DARURAT: NUTRISI DROP',
      message: '🚨 NUTRISI DROP! Dosing otomatis diaktifkan.',
      canManualControl: true,
      alertLevel: 'danger'
    };
  }

  if (tds > tdsCritHigh) {
    return {
      state: 'DANGER_HIGH_TDS',
      theme: '#991b1b',
      badge: 'BAHAYA: OVERDOSIS NUTRISI',
      message: '🚨 BAHAYA: OVERDOSIS NUTRISI! Hard Safety Lock aktif.',
      canManualControl: false, // Control interlock hard lock
      alertLevel: 'critical'
    };
  }

  if (ph < 5.0 || ph > 7.0) {
    const guidance = ph < 5.0
      ? 'Tindakan: Segera tambahkan cairan pH Up secara manual ke tandon.'
      : 'Tindakan: Segera tambahkan cairan pH Down secara manual ke tandon.';
    return {
      state: 'DANGER_PH',
      theme: '#dc2626',
      badge: 'BAHAYA: pH ABNORMAL',
      message: ph < 5.0 ? '🚨 pH TERLALU ASAM!' : '🚨 pH TERLALU BASA!',
      guidance,
      canManualControl: true,
      alertLevel: 'danger'
    };
  }

  // Siaga warning check
  const isPhSiaga = (ph >= 5.0 && ph < phMin) || (ph > phMax && ph <= 7.0);
  const isTdsSiaga = (tds >= tdsCritLow && tds < tdsMin) || (tds > tdsMax && tds <= tdsCritHigh);

  if (isPhSiaga || isTdsSiaga) {
    return {
      state: 'SIAGA',
      theme: '#eab308',
      badge: 'SIAGA: PANTAU BERKALA',
      message: '⚠️ Kondisi Siaga: Parameter bergeser dari rentang ideal.',
      canManualControl: true,
      alertLevel: 'warning'
    };
  }

  // Normal / Ideal State
  return {
    state: 'NORMAL',
    theme: '#22c55e',
    badge: 'NORMAL - SELADA HAPPY 🥬',
    message: 'STATUS: NORMAL. SELADA HAPPY! ^_^',
    canManualControl: true,
    alertLevel: 'normal'
  };
}

