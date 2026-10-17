// A small SMTP client: enough to hand a plain-text message to a mail server (TLS on 465, STARTTLS elsewhere, AUTH PLAIN).
// BLOKI_SMTP_URL is smtps://user:pass@host:465 or smtp://user:pass@host:587; without it Bloki sends no email.
import { connect as tcp } from 'node:net'
import { connect as tls } from 'node:tls'
import { randomUUID } from 'node:crypto'

export function mailer(smtpUrl, from) {
  if (!smtpUrl) return null
  const u = new URL(smtpUrl)
  const secure = u.protocol === 'smtps:'
  const host = u.hostname, port = Number(u.port || (secure ? 465 : 587))
  // Plain text over the network only to this machine (a local relay); anything else must use TLS.
  const local = ['localhost', '127.0.0.1', '::1'].includes(host)
  const user = decodeURIComponent(u.username), pass = decodeURIComponent(u.password)
  const sender = from || `Bloki <${user.includes('@') ? user : 'bloki@' + host}>`
  const address = s => /<([^>]+)>/.exec(s)?.[1] ?? s

  return function send({ to, subject, text }) {
    if (/[\r\n]/.test(to + subject)) return Promise.reject(new Error('Invalid header'))
    return new Promise((resolve, reject) => {
      let sock = secure ? tls({ host, port, servername: host }) : tcp({ host, port })
      sock.setTimeout(15000, () => sock.destroy(new Error('SMTP timeout')))
      let buf = '', waiting = null
      // A reply ends with a line "250 text" (a dash after the code means more lines follow); it may arrive before we ask.
      const deliver = () => {
        const m = /(?:^|\r\n)(\d{3}) [^\r\n]*\r\n$/.exec(buf)
        if (m && waiting) { const w = waiting, reply = buf; waiting = null; buf = ''; w(Number(m[1]), reply) }
      }
      const onData = d => { buf += d; deliver() }
      const read = () => new Promise(r => { waiting = (code, reply) => r({ code, reply }); deliver() })
      const cmd = async (line, ok = [250]) => {
        sock.write(line + '\r\n')
        const r = await read()
        if (!ok.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.reply.trim().split('\r\n').at(-1)}`)
        return r.reply
      }
      const attach = s => { s.setEncoding('utf8'); s.on('data', onData); s.on('error', reject) }
      attach(sock)
      ;(async () => {
        if ((await read()).code !== 220) throw new Error('SMTP server did not greet')
        let caps = await cmd('EHLO bloki')
        if (!secure) {
          if (/STARTTLS/i.test(caps)) {
            await cmd('STARTTLS', [220])
            sock.removeListener('data', onData)
            sock = tls({ socket: sock, servername: host })
            attach(sock)
            await new Promise((r, j) => { sock.once('secureConnect', r); sock.once('error', j) })
            caps = await cmd('EHLO bloki')
          } else if (!local) throw new Error('SMTP server offers no STARTTLS; use smtps:// or a server with TLS.')
        }
        if (user) await cmd('AUTH PLAIN ' + Buffer.from(`\0${user}\0${pass}`).toString('base64'), [235])
        await cmd(`MAIL FROM:<${address(sender)}>`)
        await cmd(`RCPT TO:<${address(to)}>`, [250, 251])
        await cmd('DATA', [354])
        const body = text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') // dot-stuffing
        const subj = /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`
        await cmd([`From: ${sender}`, `To: ${to}`, `Subject: ${subj}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${randomUUID()}@${host}>`,
          'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', body, '.'].join('\r\n'))
        await cmd('QUIT', [221]).catch(() => {})
        sock.end()
        resolve()
      })().catch(e => { sock.destroy(); reject(e) })
    })
  }
}
