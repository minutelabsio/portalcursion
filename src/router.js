import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/playground' },
  { path: '/playground', component: () => import('./pages/Playground.vue') },
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
