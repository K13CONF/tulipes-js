import { config } from 'dotenv'

// Get the runtime environment, fallback on development
const { NODE_ENV = 'development' } = process.env;


// Load the env file
const env = config({
    path: `./.envs/.env.${NODE_ENV}`
})


export default env