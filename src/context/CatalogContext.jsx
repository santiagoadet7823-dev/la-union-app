import { createContext, useContext, useEffect, useState } from 'react'
import { loadCsv } from '../lib/csv'
import { inferCategoria } from '../lib/categoria'

const CatalogContext = createContext(null)

export function CatalogProvider({ children }) {
  const [productos, setProductos] = useState([])
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const base = import.meta.env.BASE_URL || './'

    Promise.all([loadCsv(`${base}data/productos.csv`), loadCsv(`${base}data/clientes.csv`)])
      .then(([prodRows, cliRows]) => {
        setProductos(
          prodRows
            .filter((p) => p.id_producto)
            .map((p) => ({ ...p, categoria: inferCategoria(p.descripcion) }))
        )
        setClientes(cliRows.filter((c) => c.id_cliente))
      })
      .catch((err) => {
        console.error('Error cargando catálogo:', err)
        setError(err)
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <CatalogContext.Provider value={{ productos, clientes, loading, error }}>
      {children}
    </CatalogContext.Provider>
  )
}

export function useCatalog() {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog debe usarse dentro de <CatalogProvider>')
  return ctx
}
