import { createClient } from '@supabase/supabase-js'
import { Chess } from 'chess.js'

const sb = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
const $ = (id) => document.getElementById(id)
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟\uFE0E' }
const SEAT_NAMES = ['Team A · P1 (White)', 'Team B · P1 (White)', 'Team A · P2 (Black)', 'Team B · P2 (Black)']

const game = new Chess()
let room = null, mySeat = null, ply = 0, status = 'waiting'
let selected = null, hints = [], lastMove = null, players = []

async function ensureAuth() {
  const { data: { session } } = await sb.auth.getSession()
  if (!session) {
    const { error } = await sb.auth.signInAnonymously()
    if (error) console.error("Auth error:", error)
  }
}

$('create').onclick = async () => {
  await ensureAuth()
  const code = $('code').value.trim() || Math.random().toString(36).slice(2, 7)
  const { error } = await sb.rpc('create_room', { p_code: code })
  if (error) return alert(error.message)
  $('code').value = code
  enter(code)
}

$('join').onclick = async () => {
  await ensureAuth()
  enter($('code').value.trim())
}

async function enter(code) {
  if (!code) return alert('Enter a room code')
  await ensureAuth()
  
  const { data, error } = await sb.rpc('join_room', {
    p_code: code, p_name: $('name').value.trim() || 'Player'
  })
  if (error) return alert(error.message)
  mySeat = data
  const { data: r } = await sb.from('rooms').select('*').eq('code', code).single()
  room = r
  $('lobby').hidden = true
  $('game').hidden = false$('roomcode').textContent = 'Room code: ' + code + ' (share it with the other 3 players)'
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

function sync(r) {
  const before = game.fen()
  game.load(r.fen)
  ply = r.ply
  status = r.status
  selected = null
  hints = []
  if (before !== r.fen) lastMove = game.history({ verbose: true }).at(-1) || null
  render()
}

const myTurn = () => status === 'playing' && mySeat === ply % 4

function render() {
  const el = $('board')
  el.innerHTML = ''
  const flip = mySeat % 2 === 1
  const board = game.board()
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const r = flip ? 7 - i : i, c = flip ? 7 - j : j
    const sq = 'abcdefgh'[c] + (8 - r)
    const p = board[r][c]
    const d = document.createElement('div')
    d.className = 'sq ' + ((r + c) % 2 ? 'dk' : 'lt')
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
  selected = null
  hints = []
  render()
  const { error } = await sb.rpc('make_move', {
    p_room: room.id, p_expected_ply: ply, p_fen: fen, p_san: m.san, p_over: over
  })
  if (error) {
    console.warn(error.message)
    const { data } = await sb.from('rooms').select('*').eq('id', room.id).single()
    sync(data)
  }
}
