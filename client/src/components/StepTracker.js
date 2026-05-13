import React from 'react';

const STEPS = [
  { id: 'analyse',   icon: '🔬', label: 'Agent 1 — Analyseur',  desc: 'Décomposition en sous-questions...' },
  { id: 'recherche', icon: '🕵️', label: 'Agent 2 — Chercheur',  desc: 'Recherche dans Qdrant, NewsAPI, SerpAPI...' },
  { id: 'jugement',  icon: '⚖️', label: 'Agent 3 — Juge',       desc: 'Analyse des preuves et verdict...' },
  { id: 'hitl',      icon: '👤', label: 'Validation humaine',    desc: 'Envoi au validateur (verdict FAUX)...' },
  { id: 'logging',   icon: '📊', label: 'Journalisation',        desc: 'Enregistrement dans Google Sheets...' },
  { id: 'termine',   icon: '✅', label: 'Terminé',               desc: 'Rapport prêt !' },
];

function getStepIndex(etape) {
  return STEPS.findIndex(s => s.id === etape);
}

export default function StepTracker({ etape }) {
  const currentIndex = getStepIndex(etape);

  return (
    <div className="tracker-container">
      <div className="tracker-card">
        <h2 className="tracker-title">Vérification en cours...</h2>
        <p className="tracker-sub">Nos agents IA analysent votre affirmation</p>

        {/* Barre de progression globale */}
        <div className="progress-bar-outer">
          <div
            className="progress-bar-inner"
            style={{ width: `${Math.max(5, ((currentIndex + 1) / STEPS.length) * 100)}%` }}
          />
        </div>

        {/* Étapes */}
        <div className="steps-list">
          {STEPS.map((step, i) => {
            const isDone    = i < currentIndex;
            const isActive  = i === currentIndex;
            const isPending = i > currentIndex;

            return (
              <div
                key={step.id}
                className={`step-item ${isDone ? 'done' : ''} ${isActive ? 'active' : ''} ${isPending ? 'pending' : ''}`}
              >
                <div className="step-icon-wrap">
                  {isDone  && <span className="step-check">✓</span>}
                  {isActive && <span className="step-spinner" />}
                  {isPending && <span className="step-dot" />}
                </div>
                <div className="step-content">
                  <div className="step-label">
                    <span className="step-emoji">{step.icon}</span>
                    <span>{step.label}</span>
                  </div>
                  {isActive && (
                    <p className="step-desc">{step.desc}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="tracker-hint">⏱ Temps estimé : 10 à 30 secondes</p>
      </div>
    </div>
  );
}
