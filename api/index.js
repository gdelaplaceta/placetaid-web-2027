import express from 'express'
import { api } from '../server/api.js'

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '48kb' }))
app.use('/api', api)

export default app
