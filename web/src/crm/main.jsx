import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Los mismos tokens, temas y tipografías que la app (plan 41: "el diseño de DisT-At").
import '../index.css'
import '../components/ui/ui.css'
import './crm.css'
import CrmApp from './CrmApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <CrmApp />
  </StrictMode>
)
