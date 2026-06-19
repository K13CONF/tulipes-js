import { config } from 'dotenv'

// Get the ruuntime envirenment, fallback on development
// const { NODE_ENV = 'development' } = process.env;
const { NODE_ENV = 'example' } = process.env;


// Load the env file
const env = config({
    path: `./.envs/.env.${NODE_ENV}`
})


export default env