import React from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import InspectorAuth from './auth/InspectorAuth.jsx'
import './styles/app.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <InspectorAuth>
        <App />
      </InspectorAuth>
    </ErrorBoundary>
    <Analytics />
  </React.StrictMode>
)
