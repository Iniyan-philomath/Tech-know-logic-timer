/**
 * Tech Know Logic — Multi-Team Concurrent Timer & Time Logs
 * Independent precise timers, row-wise horizontal layout, audio alarm beeps,
 * early completion logging, and full event time records (without scores/ranking).
 */

// ============================================================================
// State & Storage
// ============================================================================
const STORAGE_KEY = 'tech_know_logic_teams_v2';
const SETTINGS_KEY = 'tech_know_logic_settings_v2';

let teams = [];
let settings = {
  soundEnabled: true,
  speechEnabled: true
};

// Global audio context for synthesizing alarm sound without external files
let audioCtx = null;
let currentAlarmInterval = null;
let activeAlarmOscillators = [];

// ============================================================================
// Audio Synthesizer (Web Audio API)
// ============================================================================
function initAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

/**
 * Multi-pulse loud alarm beep pattern indicating countdown has reached 00:00
 */
function playAlarmSound() {
  if (!settings.soundEnabled) return;
  try {
    initAudio();
    if (!audioCtx) return;

    // Stop any currently playing alarm first
    stopAlarmSound();

    let beepCount = 0;

    function triggerBeepBurst() {
      if (!audioCtx || audioCtx.state === 'suspended') return;
      const now = audioCtx.currentTime;

      // 3 rapid sharp digital alarm beeps
      [0, 0.15, 0.3].forEach((offset, idx) => {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        // Alternating high urgent frequencies (1200Hz & 950Hz)
        osc.type = 'square';
        osc.frequency.setValueAtTime(idx % 2 === 0 ? 1200 : 950, now + offset);

        gainNode.gain.setValueAtTime(0.22, now + offset);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.1);

        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        osc.start(now + offset);
        osc.stop(now + offset + 0.11);

        activeAlarmOscillators.push(osc);
      });

      beepCount++;
      // Stop automatically after 8 bursts (about 6 seconds) if not acknowledged
      if (beepCount >= 8) {
        clearInterval(currentAlarmInterval);
        currentAlarmInterval = null;
      }
    }

    // Immediately play first burst
    triggerBeepBurst();

    // Repeat every 750ms
    currentAlarmInterval = setInterval(triggerBeepBurst, 750);
  } catch (err) {
    console.warn('Audio playback error:', err);
  }
}

function stopAlarmSound() {
  if (currentAlarmInterval) {
    clearInterval(currentAlarmInterval);
    currentAlarmInterval = null;
  }
  activeAlarmOscillators.forEach(osc => {
    try { osc.stop(); } catch (e) {}
  });
  activeAlarmOscillators = [];
}

function playChimeSound(type = 'click') {
  if (!settings.soundEnabled) return;
  try {
    initAudio();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = 'sine';

    if (type === 'success') {
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.1); // E5
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.22); // G5
      gainNode.gain.setValueAtTime(0.2, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    } else if (type === 'click') {
      osc.frequency.setValueAtTime(700, now);
      gainNode.gain.setValueAtTime(0.1, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    }

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
  } catch (e) {
    console.warn('Chime error:', e);
  }
}

// ============================================================================
// Text to Speech Announcement
// ============================================================================
function speakAnnouncement(text) {
  if (!settings.speechEnabled) return;
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.05;
      utterance.volume = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech error:', e);
    }
  }
}

// ============================================================================
// Time Formatting Utilities
// ============================================================================
function formatTime(ms) {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDetailedDuration(ms) {
  if (ms == null) return '--';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function formatClockTime(date) {
  if (!date) return '--:--';
  const d = new Date(date);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ============================================================================
// Data Persistence
// ============================================================================
function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      teams = JSON.parse(saved);
    }
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
      settings = { ...settings, ...JSON.parse(savedSettings) };
    }
  } catch (e) {
    console.error('Failed to load local storage:', e);
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(teams));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save to local storage:', e);
  }
}

// ============================================================================
// Independent Timing Calculations (Drift-Free)
// ============================================================================
function getTeamTiming(team) {
  const targetMs = team.targetDurationMs || (12 * 60 * 1000);

  if (team.status === 'ready') {
    return {
      elapsedMs: 0,
      remainingMs: targetMs,
      progressPct: 0
    };
  }

  if (team.status === 'completed' || team.status === 'time_over') {
    const elapsed = team.elapsedAtStop != null ? team.elapsedAtStop : targetMs;
    const remaining = Math.max(0, targetMs - elapsed);
    const progress = Math.min(100, (elapsed / targetMs) * 100);
    return {
      elapsedMs: elapsed,
      remainingMs: remaining,
      progressPct: progress
    };
  }

  if (team.status === 'paused') {
    const elapsed = (team.pausedAt - team.startTime) - (team.accumulatedPausedMs || 0);
    const remaining = Math.max(0, targetMs - elapsed);
    const progress = Math.min(100, (elapsed / targetMs) * 100);
    return {
      elapsedMs: Math.max(0, elapsed),
      remainingMs: remaining,
      progressPct: progress
    };
  }

  // Running
  const now = Date.now();
  const elapsed = (now - team.startTime) - (team.accumulatedPausedMs || 0);
  const remaining = targetMs - elapsed;
  const progress = Math.min(100, Math.max(0, (elapsed / targetMs) * 100));

  return {
    elapsedMs: Math.max(0, elapsed),
    remainingMs: remaining,
    progressPct: progress
  };
}

// ============================================================================
// Timer Engine Tick
// ============================================================================
function tickTimers() {
  let stateChanged = false;

  teams.forEach(team => {
    if (team.status === 'running') {
      const timing = getTeamTiming(team);

      // Check if time has run out
      if (timing.remainingMs <= 0) {
        team.status = 'time_over';
        team.elapsedAtStop = team.targetDurationMs;
        team.finishedAt = Date.now();
        stateChanged = true;

        if (!team.alerted) {
          team.alerted = true;
          handleTimeOver(team);
        }
      }
    }
  });

  if (stateChanged) {
    saveData();
  }

  renderTimersQuick();
  updateHeaderStats();
}

function handleTimeOver(team) {
  playAlarmSound();
  const alertMsg = `Time over for ${team.teamName}!`;
  speakAnnouncement(alertMsg);

  showToast(`Time Over for "${team.teamName}"!`, 'danger', '⏰');
  openTimeOverModal(team);
}

// ============================================================================
// UI Toast Notifications
// ============================================================================
function showToast(message, type = 'info', icon = 'ℹ️') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-content">
      <div class="toast-title">${type.toUpperCase()}</div>
      <div class="toast-msg">${message}</div>
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// ============================================================================
// Time Over Modal
// ============================================================================
function openTimeOverModal(team) {
  const modal = document.getElementById('alert-modal');
  document.getElementById('modal-team-name').textContent = team.teamName;
  document.getElementById('modal-participants').textContent = `Participants: ${team.participants || 'N/A'}`;
  document.getElementById('modal-duration').textContent = formatDetailedDuration(team.targetDurationMs);
  document.getElementById('modal-elapsed').textContent = formatDetailedDuration(team.elapsedAtStop || team.targetDurationMs);

  modal.classList.add('open');
}

function closeTimeOverModal() {
  const modal = document.getElementById('alert-modal');
  modal.classList.remove('open');
  stopAlarmSound();
}

// ============================================================================
// Team Actions (Start, Pause, Resume, Stop/Record, Adjust, Delete)
// ============================================================================
function startTeamTimer(teamId) {
  initAudio();
  const team = teams.find(t => t.id === teamId);
  if (!team) return;

  if (team.status === 'ready') {
    team.startTime = Date.now();
    team.accumulatedPausedMs = 0;
    team.pausedAt = null;
    team.status = 'running';
    team.alerted = false;
    showToast(`Timer started for "${team.teamName}"`, 'info', '⏱️');
    playChimeSound('click');
  } else if (team.status === 'paused') {
    const pauseDuration = Date.now() - team.pausedAt;
    team.accumulatedPausedMs = (team.accumulatedPausedMs || 0) + pauseDuration;
    team.pausedAt = null;
    team.status = 'running';
    showToast(`Timer resumed for "${team.teamName}"`, 'info', '▶️');
    playChimeSound('click');
  }

  saveData();
  renderAll();
}

function pauseTeamTimer(teamId) {
  initAudio();
  const team = teams.find(t => t.id === teamId);
  if (!team || team.status !== 'running') return;

  team.status = 'paused';
  team.pausedAt = Date.now();
  showToast(`Timer paused for "${team.teamName}"`, 'warning', '⏸️');
  playChimeSound('click');

  saveData();
  renderAll();
}

/**
 * Stop and Record: When a team finishes early (e.g. 2 mins before),
 * records the exact elapsed time and logs it directly.
 */
function stopAndRecordTeam(teamId) {
  initAudio();
  const team = teams.find(t => t.id === teamId);
  if (!team) return;

  const timing = getTeamTiming(team);
  team.status = 'completed';
  team.elapsedAtStop = timing.elapsedMs;
  team.finishedAt = Date.now();
  team.pausedAt = null;

  playChimeSound('success');
  showToast(`Team "${team.teamName}" stopped! Time taken: ${formatDetailedDuration(team.elapsedAtStop)} logged.`, 'success', '🏁');

  saveData();
  renderAll();
}

function resetTeamTimer(teamId) {
  if (!confirm('Are you sure you want to reset this team\'s timer?')) return;
  const team = teams.find(t => t.id === teamId);
  if (!team) return;

  team.status = 'ready';
  team.startTime = null;
  team.pausedAt = null;
  team.accumulatedPausedMs = 0;
  team.elapsedAtStop = null;
  team.finishedAt = null;
  team.alerted = false;

  showToast(`Timer reset for "${team.teamName}"`, 'info', '🔄');
  saveData();
  renderAll();
}

function adjustTeamDuration(teamId, deltaMinutes) {
  const team = teams.find(t => t.id === teamId);
  if (!team) return;

  const deltaMs = deltaMinutes * 60 * 1000;
  const newTarget = Math.max(60000, team.targetDurationMs + deltaMs); // minimum 1 min
  team.targetDurationMs = newTarget;

  if (team.status === 'time_over' && deltaMinutes > 0) {
    const timing = getTeamTiming(team);
    if (timing.remainingMs > 0) {
      team.status = 'running';
      team.alerted = false;
    }
  }

  showToast(`Adjusted ${deltaMinutes > 0 ? '+' : ''}${deltaMinutes}m for "${team.teamName}"`, 'info', '⏳');
  saveData();
  renderAll();
}

function deleteTeam(teamId) {
  const team = teams.find(t => t.id === teamId);
  if (!team) return;
  if (!confirm(`Delete team "${team.teamName}"? This action cannot be undone.`)) return;

  teams = teams.filter(t => t.id !== teamId);
  showToast(`Deleted team "${team.teamName}"`, 'info', '🗑️');
  saveData();
  renderAll();
}

// ============================================================================
// Rendering: Horizontal Row-Wise Rectangle List (Many Timers in One Screen)
// ============================================================================
function renderTimersList() {
  const list = document.getElementById('teams-list');
  const emptyState = document.getElementById('empty-state');
  if (!list) return;

  const searchTerm = (document.getElementById('search-teams')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('status-filter')?.value || 'all';

  const filteredTeams = teams.filter(team => {
    const matchesSearch = team.teamName.toLowerCase().includes(searchTerm) ||
      (team.participants && team.participants.toLowerCase().includes(searchTerm));
    const matchesStatus = statusFilter === 'all' || team.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (teams.length === 0) {
    list.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  list.style.display = 'flex';

  list.innerHTML = filteredTeams.map(team => {
    const timing = getTeamTiming(team);
    const countdownStr = formatTime(timing.remainingMs);
    const elapsedStr = formatDetailedDuration(timing.elapsedMs);

    let statusLabel = 'Ready';
    if (team.status === 'running') statusLabel = 'Running';
    if (team.status === 'paused') statusLabel = 'Paused';
    if (team.status === 'completed') statusLabel = 'Completed';
    if (team.status === 'time_over') statusLabel = 'Time Over';

    let progressColorClass = 'running';
    if (team.status === 'completed') progressColorClass = 'completed';
    else if (team.status === 'time_over' || timing.remainingMs < 120000) progressColorClass = 'danger';
    else if (timing.remainingMs < 300000) progressColorClass = 'warning';

    // Controls setup
    let primaryBtnHtml = '';
    if (team.status === 'ready') {
      primaryBtnHtml = `
        <button class="action-btn primary sm" onclick="startTeamTimer('${team.id}')">
          <i class="fa-solid fa-play"></i> Start
        </button>
      `;
    } else if (team.status === 'running') {
      primaryBtnHtml = `
        <button class="action-btn warning sm" onclick="pauseTeamTimer('${team.id}')" title="Pause Timer">
          <i class="fa-solid fa-pause"></i> Pause
        </button>
        <button class="action-btn success sm" onclick="stopAndRecordTeam('${team.id}')" title="Stop & Record Exact Finish Time">
          <i class="fa-solid fa-flag-checkered"></i> Stop &amp; Record
        </button>
      `;
    } else if (team.status === 'paused') {
      primaryBtnHtml = `
        <button class="action-btn primary sm" onclick="startTeamTimer('${team.id}')" title="Resume Timer">
          <i class="fa-solid fa-play"></i> Resume
        </button>
        <button class="action-btn success sm" onclick="stopAndRecordTeam('${team.id}')" title="Stop & Record Exact Finish Time">
          <i class="fa-solid fa-flag-checkered"></i> Stop &amp; Record
        </button>
      `;
    } else {
      // Completed or Time Over
      primaryBtnHtml = `
        <button class="action-btn outline sm" onclick="resetTeamTimer('${team.id}')" title="Restart Timer">
          <i class="fa-solid fa-rotate-right"></i> Restart
        </button>
      `;
    }

    return `
      <div class="team-row state-${team.status}" id="row-${team.id}">
        <!-- Col 1: Team Info -->
        <div class="team-row-meta">
          <div class="team-meta-top">
            <span class="team-name-title" title="${escapeHtml(team.teamName)}">${escapeHtml(team.teamName)}</span>
            <span class="status-badge ${team.status}">
              <i class="fa-solid ${getStatusIcon(team.status)}"></i> ${statusLabel}
            </span>
          </div>
          <div class="participants-tag" title="${escapeHtml(team.participants || 'N/A')}">
            <i class="fa-solid fa-user-group"></i>
            <span>${escapeHtml(team.participants || 'N/A')}</span>
          </div>
        </div>

        <!-- Col 2: Big Countdown & Elapsed -->
        <div class="team-row-timer">
          <div class="timer-countdown state-${team.status}" id="countdown-${team.id}">
            ${countdownStr}
          </div>
          <div class="timer-sub-metrics">
            <span>Taken:</span>
            <span class="metric-val" id="elapsed-${team.id}">${elapsedStr}</span>
          </div>
        </div>

        <!-- Col 3: Slim Progress Bar -->
        <div class="team-row-progress">
          <div class="progress-info-row">
            <span>Progress (${formatDetailedDuration(team.targetDurationMs)} limit)</span>
            <span id="pct-${team.id}" class="font-mono">${Math.round(timing.progressPct)}%</span>
          </div>
          <div class="row-progress-bar">
            <div class="row-progress-fill ${progressColorClass}" id="progress-${team.id}" style="width: ${timing.progressPct}%"></div>
          </div>
        </div>

        <!-- Col 4: Action Controls -->
        <div class="team-row-actions">
          <div class="primary-controls">
            ${primaryBtnHtml}
          </div>
          <div class="secondary-controls">
            <div class="time-adjust-group" title="Add or subtract 1 minute">
              <button class="btn-adjust" onclick="adjustTeamDuration('${team.id}', -1)">-1m</button>
              <button class="btn-adjust" onclick="adjustTeamDuration('${team.id}', 1)">+1m</button>
            </div>
            <button class="btn-adjust" style="color: var(--rose-danger)" onclick="deleteTeam('${team.id}')" title="Delete Team">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Fast DOM update for running timers every 250ms
function renderTimersQuick() {
  teams.forEach(team => {
    if (team.status === 'running') {
      const timing = getTeamTiming(team);
      const countdownElem = document.getElementById(`countdown-${team.id}`);
      const elapsedElem = document.getElementById(`elapsed-${team.id}`);
      const progressElem = document.getElementById(`progress-${team.id}`);
      const pctElem = document.getElementById(`pct-${team.id}`);

      if (countdownElem) {
        countdownElem.textContent = formatTime(timing.remainingMs);
      }
      if (elapsedElem) {
        elapsedElem.textContent = formatDetailedDuration(timing.elapsedMs);
      }
      if (pctElem) {
        pctElem.textContent = `${Math.round(timing.progressPct)}%`;
      }
      if (progressElem) {
        progressElem.style.width = `${timing.progressPct}%`;
        if (timing.remainingMs < 120000) {
          progressElem.className = 'row-progress-fill danger';
        } else if (timing.remainingMs < 300000) {
          progressElem.className = 'row-progress-fill warning';
        } else {
          progressElem.className = 'row-progress-fill running';
        }
      }
    }
  });
}

function getStatusIcon(status) {
  switch (status) {
    case 'running': return 'fa-spinner fa-spin';
    case 'paused': return 'fa-circle-pause';
    case 'completed': return 'fa-circle-check';
    case 'time_over': return 'fa-triangle-exclamation';
    default: return 'fa-hourglass-start';
  }
}

// ============================================================================
// Event Time Logs (Details and Times Alone - No Scores / No Ranking)
// ============================================================================
function renderLogs() {
  const tbody = document.getElementById('logs-tbody');
  const emptyLogs = document.getElementById('empty-logs');
  if (!tbody) return;

  if (teams.length === 0) {
    tbody.innerHTML = '';
    if (emptyLogs) emptyLogs.style.display = 'block';
    return;
  }

  if (emptyLogs) emptyLogs.style.display = 'none';

  // Display all registered teams in logged order
  tbody.innerHTML = teams.map((team, index) => {
    const timing = getTeamTiming(team);
    const timeTaken = team.elapsedAtStop != null ? team.elapsedAtStop : timing.elapsedMs;
    const timeLeft = timing.remainingMs;

    let statusDisplay = team.status.toUpperCase();
    if (team.status === 'completed') statusDisplay = 'COMPLETED EARLY';
    if (team.status === 'time_over') statusDisplay = 'TIME OVER (12M)';

    return `
      <tr>
        <td>
          <span class="log-index-badge">${index + 1}</span>
        </td>
        <td>
          <div class="team-cell-title">${escapeHtml(team.teamName)}</div>
        </td>
        <td>
          <span class="participants-sub">${escapeHtml(team.participants || 'N/A')}</span>
        </td>
        <td>
          <span class="time-cell-val">${formatDetailedDuration(timeTaken)}</span>
        </td>
        <td>
          <span class="time-cell-remaining">${formatDetailedDuration(timeLeft)}</span>
        </td>
        <td>
          <span style="font-size: 0.85rem; color: var(--text-dim);">${formatDetailedDuration(team.targetDurationMs)}</span>
        </td>
        <td>
          <span class="status-badge ${team.status}">
            ${statusDisplay}
          </span>
        </td>
        <td>
          <span style="font-size: 0.8rem; color: var(--text-dim)">
            ${team.startTime ? formatClockTime(team.startTime) : 'Not Started'}
          </span>
        </td>
        <td>
          <span style="font-size: 0.8rem; color: var(--text-dim)">
            ${team.finishedAt ? formatClockTime(team.finishedAt) : (team.status === 'time_over' ? 'Finished (12m)' : '--')}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================================
// Header Statistics & Live Clock
// ============================================================================
function updateHeaderStats() {
  const total = teams.length;
  const running = teams.filter(t => t.status === 'running').length;
  const finished = teams.filter(t => t.status === 'completed' || t.status === 'time_over').length;

  const totalElem = document.getElementById('stat-total');
  const runningElem = document.getElementById('stat-running');
  const finishedElem = document.getElementById('stat-finished');
  const activeBadge = document.getElementById('active-badge');
  const logsBadge = document.getElementById('logs-badge');

  if (totalElem) totalElem.textContent = total;
  if (runningElem) runningElem.textContent = running;
  if (finishedElem) finishedElem.textContent = finished;
  if (activeBadge) activeBadge.textContent = total;
  if (logsBadge) logsBadge.textContent = finished;
}

function updateLiveClock() {
  const clockElem = document.getElementById('header-clock');
  if (clockElem) {
    clockElem.textContent = new Date().toLocaleTimeString();
  }
}

// ============================================================================
// Export Logs to CSV
// ============================================================================
function exportResultsToCSV() {
  if (teams.length === 0) {
    showToast('No teams to export!', 'warning', '⚠️');
    return;
  }

  const headers = ['#', 'Team Name', 'Participants', 'Time Taken (Elapsed)', 'Time Remaining', 'Target Limit', 'Status', 'Registered At', 'Started At', 'Finished At'];

  const rows = teams.map((team, idx) => {
    const timing = getTeamTiming(team);
    const timeTaken = team.elapsedAtStop != null ? team.elapsedAtStop : timing.elapsedMs;
    return [
      idx + 1,
      `"${(team.teamName || '').replace(/"/g, '""')}"`,
      `"${(team.participants || '').replace(/"/g, '""')}"`,
      formatDetailedDuration(timeTaken),
      formatDetailedDuration(timing.remainingMs),
      formatDetailedDuration(team.targetDurationMs),
      team.status,
      team.createdAt ? new Date(team.createdAt).toLocaleString() : 'N/A',
      team.startTime ? new Date(team.startTime).toLocaleString() : 'N/A',
      team.finishedAt ? new Date(team.finishedAt).toLocaleString() : (team.status === 'time_over' ? 'Time Expired' : 'N/A')
    ];
  });

  const csvContent = 'data:text/csv;charset=utf-8,' +
    [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Tech_Know_Logic_Time_Logs_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('Time logs exported to CSV successfully!', 'success', '📥');
}

// ============================================================================
// Demo Data Generator for Testing
// ============================================================================
function addSampleTeams() {
  const sampleTeams = [
    {
      id: 'demo_' + Date.now() + '_1',
      teamName: 'Cyber Phoenix',
      participants: 'Alex Carter, Nina Patel',
      targetDurationMs: 12 * 60 * 1000,
      status: 'completed',
      startTime: Date.now() - (10 * 60 * 1000),
      pausedAt: null,
      accumulatedPausedMs: 0,
      elapsedAtStop: 10 * 60 * 1000, // Finished at 10m 00s (2 mins before!)
      finishedAt: Date.now() - 120000,
      createdAt: Date.now() - 3600000,
      alerted: false
    },
    {
      id: 'demo_' + Date.now() + '_2',
      teamName: 'Quantum Coders',
      participants: 'Marcus Ray, Elena Rostov',
      targetDurationMs: 12 * 60 * 1000,
      status: 'running',
      startTime: Date.now() - (5 * 60 * 1000), // Running for 5 mins
      pausedAt: null,
      accumulatedPausedMs: 0,
      elapsedAtStop: null,
      finishedAt: null,
      createdAt: Date.now() - 3500000,
      alerted: false
    },
    {
      id: 'demo_' + Date.now() + '_3',
      teamName: 'Binary Blitz',
      participants: 'David Kim, Sarah Jenkins',
      targetDurationMs: 12 * 60 * 1000,
      status: 'running',
      startTime: Date.now() - (2 * 60 * 1000), // Running for 2 mins (started later!)
      pausedAt: null,
      accumulatedPausedMs: 0,
      elapsedAtStop: null,
      finishedAt: null,
      createdAt: Date.now() - 1800000,
      alerted: false
    },
    {
      id: 'demo_' + Date.now() + '_4',
      teamName: 'Neon Knights',
      participants: 'Leo Vance, Maya Lin',
      targetDurationMs: 12 * 60 * 1000,
      status: 'time_over',
      startTime: Date.now() - (13 * 60 * 1000),
      pausedAt: null,
      accumulatedPausedMs: 0,
      elapsedAtStop: 12 * 60 * 1000,
      finishedAt: Date.now() - 60000,
      createdAt: Date.now() - 1500000,
      alerted: true
    }
  ];

  teams.push(...sampleTeams);
  saveData();
  renderAll();
  showToast('Added 4 sample teams with varying finish & running times!', 'success', '✨');
}

// ============================================================================
// Utilities
// ============================================================================
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}

function renderAll() {
  renderTimersList();
  renderLogs();
  updateHeaderStats();
}

// ============================================================================
// Initialization & Listeners
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadData();

  // Setup sound & voice buttons
  const soundBtn = document.getElementById('toggle-sound-btn');
  const speechBtn = document.getElementById('toggle-speech-btn');

  function updateSoundUI() {
    if (soundBtn) {
      soundBtn.className = `icon-toggle-btn ${settings.soundEnabled ? 'active' : ''}`;
      soundBtn.querySelector('.btn-text').textContent = `Sound: ${settings.soundEnabled ? 'ON' : 'OFF'}`;
    }
  }

  function updateSpeechUI() {
    if (speechBtn) {
      speechBtn.className = `icon-toggle-btn ${settings.speechEnabled ? 'active' : ''}`;
      speechBtn.querySelector('.btn-text').textContent = `Voice: ${settings.speechEnabled ? 'ON' : 'OFF'}`;
    }
  }

  updateSoundUI();
  updateSpeechUI();

  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      initAudio();
      settings.soundEnabled = !settings.soundEnabled;
      updateSoundUI();
      saveData();
      if (settings.soundEnabled) {
        playAlarmSound();
        setTimeout(stopAlarmSound, 1000); // Quick test of beep
      }
    });
  }

  if (speechBtn) {
    speechBtn.addEventListener('click', () => {
      settings.speechEnabled = !settings.speechEnabled;
      updateSpeechUI();
      saveData();
      if (settings.speechEnabled) speakAnnouncement('Voice announcements enabled');
    });
  }

  // Duration Presets
  const presetButtons = document.querySelectorAll('.preset-pill');
  const durationInput = document.getElementById('duration-mins');

  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      presetButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mins = btn.getAttribute('data-min');
      if (durationInput) durationInput.value = mins;
    });
  });

  if (durationInput) {
    durationInput.addEventListener('input', () => {
      presetButtons.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-min') === durationInput.value);
      });
    });
  }

  // Team Registration Form
  const teamForm = document.getElementById('team-form');
  if (teamForm) {
    teamForm.addEventListener('submit', (e) => {
      e.preventDefault();
      initAudio();

      const submitter = e.submitter;
      const startNow = submitter && submitter.value === 'start_now';

      const teamNameInput = document.getElementById('team-name');
      const participantsInput = document.getElementById('participant-names');
      const durationMins = parseInt(durationInput.value, 10) || 12;

      const teamName = teamNameInput.value.trim();
      const participants = participantsInput.value.trim();

      if (!teamName) {
        showToast('Please enter a team name', 'warning', '⚠️');
        return;
      }

      const newTeam = {
        id: 'team_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        teamName,
        participants,
        targetDurationMs: durationMins * 60 * 1000,
        status: startNow ? 'running' : 'ready',
        startTime: startNow ? Date.now() : null,
        pausedAt: null,
        accumulatedPausedMs: 0,
        elapsedAtStop: null,
        finishedAt: null,
        createdAt: Date.now(),
        alerted: false
      };

      teams.unshift(newTeam);
      saveData();

      teamNameInput.value = '';
      participantsInput.value = '';
      teamNameInput.focus();

      showToast(`Team "${teamName}" registered${startNow ? ' & timer started!' : '!'}`, 'success', '🚀');
      if (startNow) {
        playChimeSound('click');
      }

      renderAll();
    });
  }

  // Tabs Switching
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetTabId = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.toggle('active', tab.id === targetTabId);
      });

      if (targetTabId === 'logs-tab') {
        renderLogs();
      }
    });
  });

  // Search & Filter
  const searchInput = document.getElementById('search-teams');
  const statusFilter = document.getElementById('status-filter');

  if (searchInput) searchInput.addEventListener('input', renderTimersList);
  if (statusFilter) statusFilter.addEventListener('change', renderTimersList);

  // Clear All
  const clearBtn = document.getElementById('clear-all-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (teams.length === 0) return;
      if (confirm('Are you sure you want to clear ALL teams and timers? This cannot be undone.')) {
        teams = [];
        saveData();
        renderAll();
        showToast('All teams cleared', 'info', '🧹');
      }
    });
  }

  // Demo Data
  const sampleBtn = document.getElementById('add-samples-btn');
  if (sampleBtn) sampleBtn.addEventListener('click', addSampleTeams);

  // Export CSV
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) exportBtn.addEventListener('click', exportResultsToCSV);

  // Print Logs
  const printBtn = document.getElementById('print-logs-btn');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      window.print();
    });
  }

  // Modal Close / Alarm Stop
  const modalCloseBtn = document.getElementById('modal-close-btn');
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeTimeOverModal);

  // Initial Render
  renderAll();

  // Engine ticks
  setInterval(tickTimers, 250);
  setInterval(updateLiveClock, 1000);
  updateLiveClock();
});
