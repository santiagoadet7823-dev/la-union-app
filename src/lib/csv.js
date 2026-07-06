import Papa from 'papaparse'

/**
 * Descarga y parsea un CSV servido desde /public.
 * Fuente de verdad = el archivo .csv en disco; no se duplica data en JS.
 * @param {string} url - ruta pública, ej. 'data/productos.csv'
 * @returns {Promise<object[]>}
 */
export function loadCsv(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (result) => resolve(result.data),
      error: (err) => reject(err),
    })
  })
}
