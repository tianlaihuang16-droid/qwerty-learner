/// <reference types="vite/client" />
declare const REACT_APP_DEPLOY_ENV: string
declare const LATEST_COMMIT_HASH: string

interface Window {
  gtag?: (command: 'event', eventName: string, properties?: Record<string, string>) => void
}
