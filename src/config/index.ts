import env from '@config/env.js'

export default (function resolveGlobalConfig(){

    return {
        env: env,
        application: {
            lib: {
                server: {

                }
            }
        }
    }
})()