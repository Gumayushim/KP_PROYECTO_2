import { loadConfig } from './config.js'
import { createApp } from './http/app.js'
import { realProcessor } from './processor.js'
import { MemoryStore } from './store/memory.js'

const config = loadConfig()
// En la fase siguiente aquí se usa la base de datos MySQL cuando hay DB_HOST definido.
const store = new MemoryStore()
console.log('Almacenamiento: MEMORIA (los datos se pierden al reiniciar; solo para pruebas locales).')

createApp({ store, config, processor: realProcessor }).listen(config.port, () => {
  console.log(`Servidor en http://localhost:${config.port}`)
})