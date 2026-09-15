import fs from 'node:fs'
import { parseEnv } from 'node:util'

// The environment a development session runs in, read once.
//
// `.env` is where a developer's connection strings and keys live, and what
// sits at that path is not always a file. A secret manager can mount a PIPE
// there instead and write the values into it each time something opens it, so
// the secrets are never on disk at all. That changes what reading means:
//
//   - opening a pipe with no writer blocks, with no timeout and no error;
//   - each open takes one fresh turn from the writer, so two reads are two
//     questions rather than one answer read twice;
//   - `statSync` answers without opening, which is why the shape of the thing
//     can be established before committing to read it.
//
// All three were measured against Node 24 and a named pipe: `readFileSync`
// and `--env-file-if-exists` both return the written values, both consume one
// writer turn, and both hang indefinitely when nothing is writing.
//
// So this is read ONCE per session and every child inherits that reading. It
// is not an optimisation. A supervisor that re-read per reload would be
// asking the writer a new question each time - and getting no answer at all
// once the writer had stopped - while the processes it was reloading had
// already used the previous one. A variable that changes wants a new session,
// which is what `pnpm dev` is.

export interface DevelopmentEnv {
  /** where `.env` is, whether it is a file, a pipe, or absent */
  readonly envFile: string
  /** the manifest every child of this session reads */
  readonly manifest: string
  /** what the person running the command typed; defaults to this process's own */
  readonly shell?: NodeJS.ProcessEnv
  /** told when this session is about to wait on a pipe, so a hang has a reason */
  readonly notice?: (message: string) => void
}

/**
 * One environment for every child of a session.
 *
 * Read here rather than inherited, because the supervisor outlives many
 * children: started with `--env-file`, its own `process.env` would hold the
 * `.env` of whenever it happened to start, and every later child would get
 * that instead of what was declared. The shell wins over the file, which is
 * what anyone typing a variable in front of a command expects.
 */
export const developmentEnv = ({
  envFile,
  manifest,
  shell = process.env,
  notice = () => {},
}: DevelopmentEnv): NodeJS.ProcessEnv => {
  const declared = readEnvFile(envFile, notice)
  return {
    ...declared,
    ...shell,
    NODE_ENV: 'development',
    QUALY_DEV_SUPERVISED: '1',
    // every child reads one manifest: a browser bundle built from a different
    // selection than the api answering it is a mismatch neither half notices
    QUALY_CONFIG: manifest,
  }
}

const readEnvFile = (file: string, notice: (message: string) => void): NodeJS.ProcessEnv => {
  // `existsSync` is true for a pipe and `statSync` does not open one, so the
  // shape is known before anything can block
  if (!fs.existsSync(file)) return {}
  if (fs.statSync(file).isFIFO()) {
    // A session about to wait says what it is waiting for. With no writer on
    // the other end this is the last thing the terminal shows, and without it
    // the session looks like one that hangs on startup for no reason.
    notice('.env is a mounted environment; reading it once for this session')
  }
  return parseEnv(fs.readFileSync(file, 'utf8'))
}
