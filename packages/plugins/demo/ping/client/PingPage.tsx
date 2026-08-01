import { useEffect, useState } from 'react'
import { useApi } from '@qualy/web-runtime'

export default function PingPage() {
  const api = useApi()
  const [message, setMessage] = useState('…')
  useEffect(() => {
    api.ping.hello({ name: 'web' }).then((result) => setMessage(result.msg))
  }, [api])
  return <h2>{message}</h2>
}
