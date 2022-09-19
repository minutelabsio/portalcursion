<template lang="pug">
.playground
  canvas(ref="canvasRef", @pointerdown="pointerDown", @pointermove="pointerMove")
</template>

<script setup>
import * as colors from '@minutelabsio/colors'
import { animationFrames } from 'intween'
import { ref, onMounted, onUnmounted } from 'vue'
import {
  createCanvas,
  createView,
} from '@wellcaffeinated/view-draw'
import Vector from '@wellcaffeinated/vector'

Vector.prototype.equals = function(other){
  if (other.x === this.x && other.y === this.y){
    return true
  }
  return false
}

const DEG = Math.PI / 180

const canvasRef = ref(null)

const view = createView([0, 100, 0, 100], (draw, state) => {
  draw.color(colors.all.light)
  draw.text('hold alt/option to rotate', [0, -80])
  // draw.text(`windings: ${state.windings.map(a => a.toString()).join(' => ')}`, [0, -80])
  state.objects.sort((a, b) => a.isInside ? -1 : 1)
  for (const obj of state.objects){
    obj.draw(draw, state)
  }
  if (state.intersection?.xingPt){
    draw.color(colors.all.ivory)
    draw.circle(state.intersection?.xingPt, 1)

    const n = Vector.create()
    state.intersection.segments.forEach((s, i) => {
      draw.color(colors.all.yellow)
      n.copy(s[1]).subtract(s[0]).setNorm(1.5).rotateBy(90 * DEG)
      draw.text(`${i}`, s[0].plus(n))
      draw.text(`${i}`, s[1].plus(n))
    })

    draw.ctx.setLineDash([10, 10])
    draw.color(colors.all.yellow).style({}).path(
      state.intersection.innerSegment,
      false,
      false,
      2
    )
    draw.ctx.setLineDash([])
  }
})

const obj = {
  pos: Vector.create(0, 0),
  r: 10,
  color: colors.pastels.yellow,
  canGrab(p){
    return this.r > this.pos.distanceTo(p)
  },
  constrain({ width, height }){
    const aspect = width / height
    const mx = aspect > 1 ? aspect : 1
    const my = aspect < 1 ? 1 / aspect : 1
    const cx = (100 - this.r) * mx
    const cy = (100 - this.r) * my
    this.pos.clampX(-cx, cx)
    this.pos.clampY(-cy, cy)
  },
  draw(d){
    d.color(this.color)
    d.circle(this.pos, this.r)
  }
}

const nearestPoint = (line, p) => {
  const a = line[0]
  const v = line[1].clone().subtract(a)
  const proj = p.clone().subtract(a).projectionClamped(v)
  return proj.add(a)
}

const displacementToLine = (line, p) => {
  const t = nearestPoint(line, p)
  return t.subtract(p)
}

const isNearly = (a, b, epsilon = 1e-8) => {
  const s = Math.abs(a + b)
  return (Math.abs(a - b) / s) < epsilon
}

const lineIntersection = (line1, line2) => {
  // https://stackoverflow.com/questions/29854085/line-segments-intersectionintersection-point
  const x1 = line1[0].x
  const y1 = line1[0].y
  const x2 = line1[1].x
  const y2 = line1[1].y
  const x3 = line2[0].x
  const y3 = line2[0].y
  const x4 = line2[1].x
  const y4 = line2[1].y

  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (d == 0) {
    return null
  }
  const xi = ((x3 - x4) * (x1 * y2 - y1 * x2) - (x1 - x2) * (x3 * y4 - y3 * x4)) / d
  if (!isNearly(x1, x2)){
    if (xi < Math.min(x1, x2) || xi > Math.max(x1, x2)) {
      return null
    }
  }
  if (!isNearly(x3, x4)){
    if (xi < Math.min(x3, x4) || xi > Math.max(x3, x4)) {
      return null
    }
  }
  const yi = ((y3 - y4) * (x1 * y2 - y1 * x2) - (y1 - y2) * (x3 * y4 - y3 * x4)) / d
  if (!isNearly(y1, y2)){
    if (yi < Math.min(y1, y2) || yi > Math.max(y1, y2)) {
      return null
    }
  }
  if (!isNearly(y3, y4)){
    if (yi < Math.min(y3, y4) || yi > Math.max(y3, y4)) {
      return null
    }
  }
  return Vector.create(xi, yi)
}

const transport = (entrance, exit, pt) => {
  const line = entrance
  const line2 = exit
  const a = line[1].minus(line[0])
  const b = line2[1].minus(line2[0])
  pt.subtract(line[0]).rotateBy(b.angle() - a.angle())
  pt.add(line2[0])
}

const applyPortalTransform = (winding, pt, portal) => {
  const [idx, dir] = winding
  const entrance = portal[idx]
  const exit = portal[idx ^ 1]
  transport(entrance.line, exit.line, pt)
}

const midpoint = (line) => line[1].plus(line[0]).multiply(0.5)

const splitLine = (line, pt) => [
  [line[0].clone(), pt.clone()],
  [pt.clone(), line[1].clone()]
]

const lineDirection = (line) => line[1].minus(line[0])

const getChirality = (division, pt) => {
  const c = pt.minus(division[0]).cross(lineDirection(division))
  return c > 0 ? 1 : c < 0 ? -1 : 0
}

const splitSegment = (division, segment, chirality) => {
  const xingPt = lineIntersection(division, segment)
  if (!xingPt){
    const ca = getChirality(division, segment[0])
    const cb = getChirality(division, segment[1])
    if (ca === chirality && cb === chirality){
      return {
        inside: segment,
        outside: null,
        xingPt: null
      }
    } else {
      return {
        inside: null,
        outside: segment,
        xingPt: null
      }
    }
  }
  // const l1 = [xingPt.clone(), segment[0].clone()]
  // const l2 = [xingPt.clone(), segment[1].clone()]
  const [l1, l2] = splitLine(segment, xingPt)
  const c1 = getChirality(division, midpoint(l1))
  if (c1 === chirality){
    return {
      inside: l1,
      outside: l2,
      xingPt
    }
  } else {
    return {
      inside: l2,
      outside: l1,
      xingPt
    }
  }
}

const getPortalSegments = (entrance, exit, segment, chirality, its = 200) => {
  if (its < 0){
    // console.log('Ran out of iterations in portal segmentation')
    const c = getChirality(entrance, midpoint(segment))
    if (c === chirality){
      // it's inside... so hide it
      return []
    }
    return [segment]
  }
  const {
    inside,
    outside,
    xingPt
  } = splitSegment(entrance, segment, chirality)

  if (!inside){
    return [outside]
  }

  transport(entrance, exit, inside[0])
  transport(entrance, exit, inside[1])

  const others = getPortalSegments(entrance, exit, inside, chirality, its - 1)
  if (outside){
    return [outside, ...others]
  } else {
    return others
  }

  // const xingPt = lineIntersection(entrance.line, segment)

  // if (!xingPt){
  //   return [segment]
  // }
  // if (xingPt.equals(segment[0]) || xingPt.equals(segment[1])){
  //   return [segment]
  // }
  // const outside = segment.slice(0)
  // outside.splice(insideEnd, 1, xingPt)
  // const inside = segment.map(v => v.clone())
  // inside.splice(insideEnd ^ 1, 1, xingPt.clone())
  // const next = inside.map(v => v.clone())
  // let din, dout
  // let touchesOuter
  // do {
  //   if (its < 0){
  //     console.log('Ran out of iterations in portal segmentation')
  //     return [outside, next]
  //   }
  //   const p1 = next[0]
  //   const p2 = next[1]
  //   inside[0].copy(p1)
  //   inside[1].copy(p2)
  //   transport(entrance, exit, p1)
  //   transport(entrance, exit, p2)
  //   din = displacementToLine(inside, next[insideEnd ^ 1]).norm()
  //   dout = displacementToLine(outside, next[insideEnd ^ 1]).norm()
  //   touchesOuter = lineIntersection(entrance.line, next)
  //   its -= 1
  // } while (din < dout && !touchesOuter)
  // const additional = getPortalSegments(entrance, exit, next, chirality, its - 1)
  // return [outside, ...additional]
}

const handlePortalIntersection = ([port1, port2]) => {
  const line1 = port1.line
  const line2 = port2.line
  const xingPt = lineIntersection(line1, line2)
  port1.xingPt = port2.xingPt = xingPt
  if (!xingPt) {
    port1.isInside = port2.isInside = false
    return null
  }
  let xing = port1.isInside || port2.isInside
  if (!xing) {
    // weren't crossing before
    const dl10 = xingPt.distanceTo(line1[0])
    const dl11 = xingPt.distanceTo(line1[1])
    const closest1 = Math.min(dl10, dl11)
    const dl20 = xingPt.distanceTo(line2[0])
    const dl21 = xingPt.distanceTo(line2[1])
    const closest2 = Math.min(dl20, dl21)
    const port2Inside = closest1 > closest2
    port2.isInside = port2Inside
    port2.insideEnd = port2.isInside && (dl20 < dl21 ? 0 : 1)
    port1.isInside = !port2Inside
    port1.insideEnd = port1.isInside && (dl10 < dl11 ? 0 : 1)
  }
  const [exit, entrance] = port2.isInside ? [port2, port1] : [port1, port2]
  const insideEnd = port2.isInside ? port2.insideEnd : port1.insideEnd
  const chirality = getChirality(entrance.line, exit.line[exit.insideEnd])
  const innerSegment = [exit.line[insideEnd], xingPt]
  const segments = getPortalSegments(entrance.line, exit.line, exit.line, chirality)
  // segments.reverse()
  return {
    exit,
    entrance,
    innerSegment,
    xingPt,
    chirality,
    segments
  }
}

const createPortalOpening = (pos, size, ang, polarity) => {
  const hitboxSize = 5
  const d = Vector.create(0, size / 2)
  const line = [pos.plus(d), pos.minus(d)]
  const w = .3
  const n = Vector.create()
  const [color1, color2] = polarity === 'plus' ?
    [
      colors.all.blue,
      colors.all.red
    ] :
    [
      colors.all.red,
      colors.all.blue
    ]

  const drawPortalLine = (d, line) => {
    const [p1, p2] = line
    d.color(color1)
    const ang = n.copy(p1).subtract(p2).angle()
    n.set(0, w).rotateBy(ang)
    d.path([p1.plus(n), p2.plus(n)], false, false, 4)
    d.color(color2)
    d.path([p1.minus(n), p2.minus(n)], false, false, 4)
  }

  return {
    pos,
    ang,
    size,
    isInside: false,
    isPortal: true,
    get line(){
      d.x = 0
      d.y = this.size / 2
      d.rotateBy(this.ang * DEG)
      line[0].copy(pos).add(d)
      line[1].copy(pos).subtract(d)
      return line
    },
    canGrab(p){
      return displacementToLine(this.line, p).norm() < hitboxSize
    },
    constrain(){

    },
    draw(d, state){
      const line = this.line

      if (this.isInside){
        const segs = state.intersection.segments
        for (let i = segs.length - 1; i >= 0; i--){
          drawPortalLine(d, segs[i])
        }
      } else {
        drawPortalLine(d, line)
      }
    }
  }
}

const portal = [
  createPortalOpening(Vector.create(-30, 0), 100, 0, 'plus'),
  createPortalOpening(Vector.create(30, 0), 100, -34, 'minus')
]

const state = {
  portal,
  objects: [
    obj,
    ...portal
  ],
  intersection: null,
  windings: []
}

const getWinding = (line, oldPos, newPos) => {
  const before = displacementToLine(line, oldPos)
  const after = displacementToLine(line, newPos)
  if (before.projectionScalar(after) < 0){
    const theta = line[1].clone().subtract(line[0]).angle()
    before.rotateBy(-theta)
    return before.y > 0 ? 1 : -1
  }
  return 0
}

const getPortalWinding = (oldPos, newPos) => {
  let z = getWinding(portal[0].line, oldPos, newPos)
  if (z){
    return [0, z]
  }
  z = getWinding(portal[1].line, oldPos, newPos)
  if (z){
    return [1, z]
  }
  return null
}

const simplifyWindings = (windings) => {
  const result = []
  let prev
  for (const w of windings){
    if (prev && prev[0] === w[0]^1){
      result.pop()
      prev = result[result.length - 1]
    } else {
      result.push(w)
      prev = w
    }
  }
  return result
}

const getPointerPos = (e) => {
  const canvas = canvasRef.value
  const pos = view.getMousePos(e, canvas)
  return Vector.create().copyArray(pos)
}

let grab = null
let grabStartPos = Vector.create()
let dragStart = null
let dragAngle = false

const pointerDown = (e) => {
  const pos = getPointerPos(e)
  dragStart = pos
  grab = state.objects.find((obj) => obj.canGrab(pos))
  if (grab){
    grabStartPos.copy(grab.pos)
  }
}

const pointerMove = e => {
  if (!dragStart){ return }
  const pos = getPointerPos(e)
  if (grab) {
    const oldPos = grab.pos.clone()
    if (e.altKey){
      if (dragAngle === false){
        dragStart = pos.clone()
        grabStartPos.copy(grab.pos)
        dragAngle = grab.ang * DEG
      } else {
        const da = pos.minus(grab.pos).angle() - dragStart.minus(grab.pos).angle() + dragAngle
        grab.ang = da / DEG
      }
    } else {

      if (dragAngle !== false) {
        dragAngle = false
        dragStart = pos.clone()
        grabStartPos.copy(grab.pos)
      }

      const d = pos.subtract(dragStart)
      grab.pos.copy(d).add(grabStartPos)
    }

    if (grab.isPortal){
      // console.log(
      //   portal[0].line[0].toString(),
      //   portal[0].line[1].toString(),
      //   portal[1].line[0].toString(),
      //   portal[1].line[1].toString(),
      // )
      state.intersection = handlePortalIntersection(portal)
      return
    }

    for (const w of state.windings) {
      applyPortalTransform(w, grab.pos, portal)
    }
    const w = getPortalWinding(oldPos, grab.pos)
    if (w){
      state.windings.push(w)
      applyPortalTransform(w, grab.pos, portal)
      state.windings = simplifyWindings(state.windings)
    }
  }
}

const pointerUp = (e) => {
  dragStart = null
  grab = null
  dragAngle = false
  state.windings = []
}

onMounted(() => {
  const canvas = canvasRef.value

  window.addEventListener('pointerup', pointerUp)

  const { destroy, dimensions } = createCanvas({ el: canvas })
  const sub = animationFrames().subscribe(() => {
    state.objects.forEach(obj => obj.constrain(dimensions))
    view.draw(canvas, state)
  })

  onUnmounted(() => {
    window.removeEventListener('pointerup', pointerUp)
    destroy()
    sub.unsubscribe()
  })
})
</script>

<style lang="sass" scoped>
.playground
  flex: 1
</style>
