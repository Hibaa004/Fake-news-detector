import React from 'react';

export default function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="logo">
          <span className="logo-icon">🔍</span>
          <div>
            <h1 className="logo-title">Fake News Detector</h1>
            <p className="logo-sub">Système Multi-Agents de Vérification d'Informations</p>
          </div>
        </div>
        <div className="header-badges">
          <span className="badge badge-gemini">Gemini AI</span>
          <span className="badge badge-rag">RAG</span>
          <span className="badge badge-agents">3 Agents</span>
        </div>
      </div>
    </header>
  );
}
