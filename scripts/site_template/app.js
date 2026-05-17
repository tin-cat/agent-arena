const DATA = {{ data_json | safe }};

const FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
Chart.defaults.font.family = FONT;
Chart.defaults.font.size = 11;
Chart.defaults.color = '#8a96a8';
Chart.defaults.borderColor = '#1f2a3a';
Chart.defaults.animation = false;

// ---------- Cost vs quality scatter ----------
if (DATA.scatter && DATA.scatter.length && document.getElementById('scatterChart')) {
  new Chart(document.getElementById('scatterChart'), {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'runs',
        data: DATA.scatter,
        backgroundColor: 'rgba(90,209,255,.7)',
        borderColor: '#ff6ad5',
        borderWidth: 1,
        pointRadius: 6,
        pointHoverRadius: 9,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f141c',
          borderColor: '#1f2a3a', borderWidth: 1,
          titleColor: '#d5dde8', bodyColor: '#8a96a8',
          callbacks: {
            title: (items) => items[0].raw.label,
            label: (ctx) => [
              ctx.raw.test + ' · ' + ctx.raw.run_id,
              '$' + ctx.raw.x.toFixed(2) + ' total · score ' + ctx.raw.y.toFixed(2),
            ],
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Total cost (USD)', color: '#8a96a8' },
          grid: { color: 'rgba(31,42,58,.6)' },
          ticks: { callback: (v) => '$' + v },
        },
        y: {
          min: 0, max: 1,
          title: { display: true, text: 'Avg rating score', color: '#8a96a8' },
          grid: { color: 'rgba(31,42,58,.6)' },
        },
      }
    }
  });
}

// ---------- Theme stacked bar ----------
if (DATA.theme_stats && DATA.theme_stats.length && document.getElementById('themeChart')) {
  const labels = DATA.theme_stats.map(t => t.theme);
  const ratings = ['excellent', 'good', 'partial', 'failed'];
  const colors = {
    excellent: '#34d399', good: '#a7f3d0', partial: '#fbbf24', failed: '#f87171',
  };
  const datasets = ratings.map(r => ({
    label: r,
    data: DATA.theme_stats.map(t => t.counts[r] || 0),
    backgroundColor: colors[r],
    borderWidth: 0,
  }));
  new Chart(document.getElementById('themeChart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#d5dde8' } },
        tooltip: { backgroundColor: '#0f141c', borderColor: '#1f2a3a', borderWidth: 1 },
      },
      scales: {
        x: { stacked: true, grid: { color: 'rgba(31,42,58,.6)' } },
        y: { stacked: true, grid: { color: 'rgba(31,42,58,.6)' }, ticks: { precision: 0 } },
      }
    }
  });
}
