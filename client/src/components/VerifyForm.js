import React, { useState } from 'react';

const EXAMPLES = [
  "Les vaccins causent l'autisme",
  "Le CO2 est le principal gaz à effet de serre",
  "Elon Musk a racheté Twitter pour 44 milliards de dollars",
  "Le Maroc est le pays le plus ensoleillé d'Afrique",
];

export default function VerifyForm({ onSubmit }) {
  const [affirmation, setAffirmation] = useState('');
  const [email,       setEmail]       = useState('');
  const [error,       setError]       = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (!affirmation.trim()) {
      setError('Veuillez saisir une affirmation à vérifier.');
      return;
    }
    setError('');
    onSubmit({ affirmation: affirmation.trim(), email: email.trim() });
  }

  function useExample(ex) {
    setAffirmation(ex);
    setError('');
  }

  return (
    <div className="form-container">
      <div className="form-card">
        <h2 className="form-title">Vérifier une affirmation</h2>
        <p className="form-desc">
          Entrez une affirmation à vérifier. Nos 3 agents IA analyseront,
          rechercheront des preuves et rendront un verdict en moins de 60 secondes.
        </p>

        {/* Exemples rapides */}
        <div className="examples">
          <p className="examples-label">Exemples rapides :</p>
          <div className="examples-list">
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                className="example-btn"
                onClick={() => useExample(ex)}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="form">
          {/* Champ affirmation */}
          <div className="field">
            <label className="field-label">
              Affirmation à vérifier <span className="required">*</span>
            </label>
            <textarea
              className="field-textarea"
              value={affirmation}
              onChange={e => setAffirmation(e.target.value)}
              placeholder="Ex : Les vaccins causent l'autisme..."
              rows={4}
              maxLength={500}
            />
            <div className="char-count">{affirmation.length}/500</div>
            {error && <p className="field-error">{error}</p>}
          </div>

          {/* Champ email (optionnel) */}
          <div className="field">
            <label className="field-label">
              Email pour recevoir le rapport <span className="optional">(optionnel)</span>
            </label>
            <input
              type="email"
              className="field-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="votre@email.com"
            />
          </div>

          <button type="submit" className="btn-verify">
            <span>🔍</span>
            <span>Analyser l'affirmation</span>
          </button>
        </form>

        {/* Pipeline info */}
        <div className="pipeline-info">
          <div className="pipeline-step">
            <span className="step-icon">🔬</span>
            <span>Agent 1<br/>Analyse</span>
          </div>
          <div className="pipeline-arrow">→</div>
          <div className="pipeline-step">
            <span className="step-icon">🕵️</span>
            <span>Agent 2<br/>Recherche</span>
          </div>
          <div className="pipeline-arrow">→</div>
          <div className="pipeline-step">
            <span className="step-icon">⚖️</span>
            <span>Agent 3<br/>Verdict</span>
          </div>
          <div className="pipeline-arrow">→</div>
          <div className="pipeline-step">
            <span className="step-icon">📋</span>
            <span>Rapport<br/>Final</span>
          </div>
        </div>
      </div>
    </div>
  );
}
