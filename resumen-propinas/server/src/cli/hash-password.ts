/** Genera el valor para ADMIN_PASSWORD_HASH:  npm run hash-password -- "tu clave" */
import { hashPassword } from '../security.js'
const clave = process.argv[2]
if (!clave || clave.length < 8) { console.error('Escribe una clave de al menos 8 caracteres: npm run hash-password -- "tu clave"'); process.exit(1) }
console.log(hashPassword(clave))