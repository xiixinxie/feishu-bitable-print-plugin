import { createApp } from 'vue'
import './style.scss'
import App from './App.vue'

try {
  createApp(App).mount('#app')
} catch (error) {
  const root = document.querySelector<HTMLElement>('#app')
  if (root) {
    root.innerHTML = `<div style="margin:28px;padding:24px;border:1px solid #ffd591;border-radius:12px;background:#fff7e8;font-family:Arial,'PingFang SC',sans-serif;color:#874d00"><b>易打印启动失败</b><p style="margin:8px 0 0">请刷新插件重试；如果仍然失败，请检查飞书后台的插件网址是否为最新发布地址。</p></div>`
  }
  console.error(error)
}


window.addEventListener('beforeprint', () => {
  document.documentElement.classList.add('is-printing');
})

window.addEventListener('afterprint', () => {
  document.documentElement.classList.remove('is-printing');
})
