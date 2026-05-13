import React, { useState } from 'react';

function VerdictBadge({ verdict }) {
  const config = {
    VRAI: {
      color: '#1E8449',
      bg: '#D5F5E3',
      icon: '✅',
      label: 'VRAI',
    },

    FAUX: {
      color: '#C0392B',
      bg: '#FADBD8',
      icon: '❌',
      label: 'FAUX',
    },

    INCERTAIN: {
      color: '#D68910',
      bg: '#FDEBD0',
      icon: '⚠️',
      label: 'INCERTAIN',
    },
  };

  const c = config[verdict] || config.INCERTAIN;

  return (
    <div
      className="verdict-badge"
      style={{
        color: c.color,
        background: c.bg,
        borderColor: c.color,
      }}
    >
      <span className="verdict-icon">
        {c.icon}
      </span>

      <span className="verdict-label">
        {c.label}
      </span>
    </div>
  );
}

function ScoreCircle({ score }) {
  // Sécurisation du score
  let safeScore = Number(score);

  if (isNaN(safeScore)) {
    safeScore = 50;
  }

  // Clamp entre 0 et 100
  safeScore = Math.max(
    0,
    Math.min(100, safeScore)
  );

  const color =
    safeScore >= 75
      ? '#1E8449'
      : safeScore <= 25
      ? '#C0392B'
      : '#D68910';

  const radius = 40;

  const circ = 2 * Math.PI * radius;

  const dashOffset =
    circ - (safeScore / 100) * circ;

  return (
    <div className="score-circle">
      <svg
        width="100"
        height="100"
        viewBox="0 0 100 100"
      >
        {/* Cercle fond */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="#eee"
          strokeWidth="10"
        />

        {/* Cercle score */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          style={{
            transition:
              'stroke-dashoffset 1s ease',
          }}
        />

        {/* Texte score */}
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dy="0.35em"
          style={{
            fontSize: '18px',
            fontWeight: 'bold',
            fill: color,
          }}
        >
          {safeScore}%
        </text>
      </svg>

      <p className="score-label">
        Fiabilité
      </p>
    </div>
  );
}

export default function ResultCard({
  resultat,
  erreur,
  onReset,
}) {
  const [tab, setTab] =
    useState('resume');

  if (!resultat) return null;

  console.log(
    'RESULTAT BACKEND :',
    resultat
  );

  // =========================
  // Gestion backend flexible
  // =========================

  const firstResult =
    resultat?.resultats?.[0] || {};

  const affirmation =
    resultat?.affirmation ||
    firstResult?.affirmation ||
    'Affirmation inconnue';

  const verdict =
    firstResult?.verdict ||
    resultat?.verdict ||
    'INCERTAIN';

  const score_fiabilite =
    firstResult?.score_fiabilite ??
    resultat?.score_fiabilite ??
    firstResult?.score ??
    50;

  // =========================
  // Arguments
  // =========================

  let arguments_pour =
    firstResult?.arguments_pour ||
    resultat?.arguments_pour ||
    [];

  let arguments_contre =
    firstResult?.arguments_contre ||
    resultat?.arguments_contre ||
    [];

  // Fallback Qdrant
  if (
    arguments_pour.length === 0 &&
    resultat?.resultats?.length > 0
  ) {
    arguments_pour =
      resultat.resultats.map((r) => {
        if (typeof r === 'string') {
          return r;
        }

        return (
          r?.payload?.text ||
          r?.payload?.content ||
          r?.payload?.source ||
          JSON.stringify(r)
        );
      });
  }

  // =========================
  // Sources
  // =========================

  let sources_citees =
    firstResult?.sources_citees ||
    resultat?.sources_citees ||
    [];

  // Fallback Qdrant
  if (
    sources_citees.length === 0 &&
    resultat?.resultats?.length > 0
  ) {
    sources_citees =
      resultat.resultats
        .map((r) => {
          if (typeof r === 'string') {
            return null;
          }

          return (
            r?.payload?.source ||
            r?.payload?.url ||
            r?.payload?.title ||
            null
          );
        })
        .filter(Boolean);
  }

  // =========================
  // Biais
  // =========================

  const biais_detectes =
    firstResult?.biais_detectes ||
    resultat?.biais_detectes ||
    [];

  // =========================
  // Recommandation
  // =========================

  const recommandation =
    firstResult?.recommandation ||
    resultat?.recommandation ||
    'Analyse terminée avec succès.';

  return (
    <div className="result-container">
      <div className="result-card">

        {/* ================= HEADER ================= */}

        <div className="result-header">

          <div className="result-header-left">

            <p className="result-claim">
              "{affirmation}"
            </p>

            <VerdictBadge
              verdict={verdict}
            />

          </div>

          <ScoreCircle
            score={score_fiabilite}
          />

        </div>

        {/* ================= ERREUR ================= */}

        {erreur && (
          <div className="result-warning">
            ⚠️ {erreur}
          </div>
        )}

        {/* ================= TABS ================= */}

        <div className="tabs">

          {[
            {
              id: 'resume',
              label: '📋 Résumé',
            },

            {
              id: 'preuves',
              label: '🔍 Preuves',
            },

            {
              id: 'sources',
              label: '📚 Sources',
            },
          ].map((t) => (
            <button
              key={t.id}
              className={`tab-btn ${
                tab === t.id
                  ? 'active'
                  : ''
              }`}
              onClick={() =>
                setTab(t.id)
              }
            >
              {t.label}
            </button>
          ))}

        </div>

        {/* ================= RESUME ================= */}

        {tab === 'resume' && (
          <div className="tab-content">

            <div className="recommandation">

              <strong>
                💡 Recommandation :
              </strong>

              <p>
                {recommandation}
              </p>

            </div>

            {biais_detectes.length >
              0 && (
              <div className="biais">

                <strong>
                  ⚠️ Biais détectés :
                </strong>

                <ul>
                  {biais_detectes.map(
                    (b, i) => (
                      <li key={i}>
                        {b}
                      </li>
                    )
                  )}
                </ul>

              </div>
            )}

          </div>
        )}

        {/* ================= PREUVES ================= */}

        {tab === 'preuves' && (
          <div className="tab-content">

            {arguments_pour.length >
              0 && (
              <div className="arguments pour">

                <h4>
                  ✅ Arguments POUR
                </h4>

                <ul>
                  {arguments_pour.map(
                    (a, i) => (
                      <li key={i}>
                        {String(a)}
                      </li>
                    )
                  )}
                </ul>

              </div>
            )}

            {arguments_contre.length >
              0 && (
              <div className="arguments contre">

                <h4>
                  ❌ Arguments CONTRE
                </h4>

                <ul>
                  {arguments_contre.map(
                    (a, i) => (
                      <li key={i}>
                        {String(a)}
                      </li>
                    )
                  )}
                </ul>

              </div>
            )}

            {arguments_pour.length ===
              0 &&
              arguments_contre.length ===
                0 && (
                <p className="empty-msg">
                  Aucun argument disponible.
                </p>
              )}

          </div>
        )}

        {/* ================= SOURCES ================= */}

        {tab === 'sources' && (
          <div className="tab-content">

            {sources_citees.length >
            0 ? (

              <ul className="sources-list">

                {sources_citees.map(
                  (s, i) => (
                    <li
                      key={i}
                      className="source-item"
                    >
                      <span className="source-icon">
                        📰
                      </span>

                      {typeof s ===
                        'string' &&
                      s.startsWith(
                        'http'
                      ) ? (
                        <a
                          href={s}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {s}
                        </a>
                      ) : (
                        <span>
                          {String(s)}
                        </span>
                      )}
                    </li>
                  )
                )}

              </ul>

            ) : (

              <p className="empty-msg">
                Aucune source citée.
              </p>

            )}

          </div>
        )}

        {/* ================= ACTIONS ================= */}

        <div className="result-actions">

          <button
            className="btn-reset"
            onClick={onReset}
          >
            🔄 Vérifier une autre
            affirmation
          </button>

          <button
            className="btn-copy"
            onClick={() => {

              const text = `
Affirmation : ${affirmation}

Verdict : ${verdict}

Score : ${score_fiabilite}%

Recommandation :
${recommandation}

Arguments POUR :
${arguments_pour.join('\n')}

Arguments CONTRE :
${arguments_contre.join('\n')}

Sources :
${sources_citees.join('\n')}
              `;

              navigator.clipboard.writeText(
                text
              );

              alert(
                'Résultat copié !'
              );
            }}
          >
            📋 Copier le résultat
          </button>

        </div>

      </div>
    </div>
  );
}