import React, { useState } from 'react';
import VerifyForm  from './components/VerifyForm';
import ResultCard  from './components/ResultCard';
import StepTracker from './components/StepTracker';
import Header      from './components/Header';
import './App.css';

const API = 'http://localhost:3001';

export default function App() {
  const [phase,     setPhase]     = useState('idle');     // idle | loading | done | error
  const [etape,     setEtape]     = useState('');
  const [resultat,  setResultat]  = useState(null);
  const [erreur,    setErreur]    = useState('');

  // ── Lancer la vérification ────────────────────────────
async function handleVerify({ affirmation, email }) {
  setPhase('loading');
  setEtape('analyse');
  setResultat(null);
  setErreur('');

  try {
    const res = await fetch(`${API}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        affirmation,
        email,
      }),
    });

    const data = await res.json();

    console.log(data);

    setResultat(data);
    setPhase('done');

  } catch (err) {
    setPhase('error');
    setErreur(err.message || 'Erreur réseau');
  }
}

  

  function handleReset() {
    setPhase('idle');
    setEtape('');
    setResultat(null);
    setErreur('');
  }

  return (
    <div className="app">
      <Header />

      <main className="main">
        {phase === 'idle' && (
          <VerifyForm onSubmit={handleVerify} />
        )}

        {phase === 'loading' && (
          <StepTracker etape={etape} />
        )}

        {phase === 'done' && resultat && (
          <ResultCard
            resultat={resultat}
            erreur={erreur}
            onReset={handleReset}
          />
        )}

        {phase === 'error' && (
          <div className="error-box">
            <span className="error-icon">⚠️</span>
            <p>{erreur}</p>
            <button className="btn-reset" onClick={handleReset}>Réessayer</button>
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Fake News Detector — Système Multi-Agents IA</p>
        <p>Hiba KAAOUACH & Oumaima BOUMAZOUED — EMSI 2025-2026</p>
      </footer>
    </div>
  );
}
