import App from './App.svelte'


const app = new App({
    target: document.body,
    props: {
        name: 'GopherSnacks'
    }
})

// Instantiate the GoTrue auth client with an optional configuration

export default app
