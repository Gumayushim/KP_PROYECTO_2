import { loadConfig } from './config.js'
import { createApp } from './http/app.js'
import { realProcessor } from './processor.js'
import { MemoryStore } from './store/memory.js'
import { MysqlStore } from './store/mysql.js'

async function main() {
  const config = loadConfig()
  let store: MemoryStore | MysqlStore
  if (config.dbHost) {
    if (!config.dbUser || !config.dbPassword) throw new Error('Faltan DB_USER o DB_PASSWORD para conectar con MySQL/TiDB.')
    const mysqlStore = new MysqlStore({
      host: config.dbHost,
      port: config.dbPort,
      user: config.dbUser,
      password: config.dbPassword,
      database: config.dbName,
    })
    await mysqlStore.init()
    store = mysqlStore
    console.log(`Almacenamiento: TiDB/MySQL (${config.dbName}).`)
  } else {
    store = new MemoryStore()
    console.log('Almacenamiento: MEMORIA (los datos se pierden al reiniciar; solo para pruebas locales).')
  }

  createApp({ store, config, processor: realProcessor }).listen(config.port, () => {
    console.log(`Servidor en http://localhost:${config.port}`)
  })
}

main().catch((error) => {
  console.error('No se pudo iniciar el servidor:', error)
  process.exit(1)
})
