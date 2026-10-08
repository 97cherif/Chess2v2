import { createClient } from '@supabase/supabase-js'
import { Chess } from 'chess.js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const sb = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null

const $ = (id) => document.getElementById(id)
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟\uFE0E' }
const SEAT_NAMES = [
  'Team A · P1 (White)',
  'Team B · P1 (Black)',
  'Team A · P2 (White)',
  'Team B · P2 (Black)'
]

const game = new Chess()
let room = null, mySeat = null, ply = 0, status = 'waiting'
let selected = null, hints = [], lastMove = null, players = []

if (!sb) {
  const banner = document.createElement('div')
  banner.style.cssText = 'background:#fdd;border:1px solid #c33;padding:10px;margin:10px;border-radius:6px'
  banner.textContent =
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Set them in Vercel (Settings → Environment Variables) and redeploy.'
  document.body.prepend(banner)
}

async function ensureAuth() {
  if (!sb) { alert('Supabase is not configured (missing env vars).'); return false }
  const { data: { session } } = await sb.auth.getSession()
  if (session) return true
  const { error } = await sb.auth.signInAnonymously()
  if (error) {
    alert('Auth failed: ' + error.message + '\n\nEnable Authentication → Providers → Anonymous Sign-ins in Supabase.')
    return false
  }
  return true
}

$('create').onclick = async () => {
  if (!(await ensureAuth())) return
  const code = $('code').value.trim() || Math.random().toString(36).slice(2, 7)
  const { error } = await sb.rpc('create_room', { p_code: code })
  if (error) return alert('Create room failed: ' + error.message)
  $('code').value = code
  enter(code)
}

$('join').onclick = async () => {
  if (!(await ensureAuth())) return
  enter($('code').value.trim())
}

async function enter(code) {
  if (!code) return alert('Enter a room code')
  if (!(await ensureAuth())) return

  const { data, error } = await sb.rpc('join_room', {
    p_code: code,
    p_name: $('name').value.trim() || 'Player'
  })
  if (error) return alert('Join failed: ' + error.message)
  mySeat = data

  const { data: r, error: rErr } = await sb.from('rooms').select('*').eq('code', code).single()
  if (rErr) return alert('Could not load room: ' + rErr.message)
  room = r

  $('lobby').hidden = true
  $('game').hidden = false
  $('roomcode').textContent = 'Room code: ' + code + ' (share it with the other 3 players)'
  await loadPlayers()
  sync(r)
  subscribe()
}

async function loadPlayers() {
  const { data } = await sb.from('room_players').select('seat,name').eq('room_id', room.id)
  players = data || []
}

function subscribe() {
  sb.channel('room-' + room.id)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` },
      (p) => sync(p.new))
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'room_players', filter: `room_id=eq.${room.id}` },
      async () => { await loadPlayers(); render() })
    .subscribe()
}

// Work out which move turned the old position into the new one (for highlighting).
function findLastMove(beforeFen, afterFen) {
  try {
    const tmp = new Chess(beforeFen)
    return tmp.moves({ verbose: true }).find((m) => m.after === afterFen) || null
  } catch {
    return null
  }
}

function sync(r) {
  const before = game.fen()
  if (before !== r.fen) {
    const found = findLastMove(before, r.fen)
    lastMove = found ? { from: found.from, to: found.to } : null
  }
  game.load(r.fen)
  ply = r.ply
  status = r.status
  selected = null
  hints = []
  render()
}

const myTurn = () => status === 'playing' && mySeat === ply % 4

function render() {
  const el = $('board')
  el.innerHTML = ''
  const flip = mySeat % 2 === 1 // Team B (Black) sees the board from Black's side
  const board = game.board()
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const r = flip ? 7 - i : i, c = flip ? 7 - j : j
    const sq = 'abcdefgh'[c] + (8 - r)
    const p = board[r][c]
    const d = document.createElement('div')
    d.className = 'sq ' + ((r + c) % 2 ? 'dk' : 'lt')
    if (lastMove && (sq === lastMove.from || sq === lastMove.to)) d.classList.add('last')
    if (sq === selected) d.classList.add('sel')
    if (hints.includes(sq)) d.classList.add('hint')
    if (p) {
      const s = document.createElement('span')
      s.className = 'pc ' + p.color
      s.textContent = GLYPH[p.type]
      d.append(s)
    }
    d.onclick = () => onSquare(sq)
    el.append(d)
  }

  const turnSeat = ply % 4
  let msg
  if (status === 'waiting') msg = `Waiting for players (${players.length}/4)…`
  else if (status === 'finished') msg = gameOverText()
  else msg = myTurn() ? '🟢 Your turn!' : `Waiting for ${SEAT_NAMES[turnSeat]}…`
  $('status').textContent = msg

  const S = $('seats')
  S.innerHTML = ''
  for (let s = 0; s < 4; s++) {
    const pl = players.find((x) => x.seat === s)
    const d = document.createElement('div')
    d.textContent = `${SEAT_NAMES[s]}: ${pl ? pl.name : '—'}`
    if (status === 'playing' && s === turnSeat) d.classList.add('active')
    if (s === mySeat) d.classList.add('me')
    S.append(d)
  }
}

function gameOverText() {
  if (game.isCheckmate()) return `Checkmate — ${game.turn() === 'w' ? 'Team B' : 'Team A'} wins!`
  return 'Game over — draw'
}

function onSquare(sq) {
  if (!myTurn()) return
  if (selected && hints.includes(sq)) return playMove(selected, sq)
  const p = game.get(sq)
  if (p && p.color === game.turn()) {
    selected = sq
    hints = game.moves({ square: sq, verbose: true }).map((m) => m.to)
  } else {
    selected = null
    hints = []
  }
  render()
}

async function playMove(from, to) {
  const m = game.move({ from, to, promotion: 'q' })
  if (!m) return
  const fen = game.fen()
  const over = game.isGameOver()
  lastMove = { from: m.from, to: m.to }
  selected = null
  hints = []
  render()
  const { error } = await sb.rpc('make_move', {
    p_room: room.id, p_expected_ply: ply, p_fen: fen, p_san: m.san, p_over: over
  })
  if (error) {
    console.warn(error.message)
    const { data } = await sb.from('rooms').select('*').eq('id', room.id).single()
    if (data) sync(data)
  }
}
