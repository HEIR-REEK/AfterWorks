'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Camera proctoring for assessments — fully on-device and free.
 *
 * Primary check: the browser's built-in FaceDetector (Shape Detection API, Chrome/Edge). When it
 * is unavailable, a fallback heuristic inspects each frame for uniform darkness/flatness, which is
 * what a covered or object-blocked camera looks like. Either way, if no person is detected for
 * several consecutive checks — or the camera stream ends (unplugged / permission revoked) — the
 * assessment is terminated automatically.
 *
 * No video or image ever leaves the device from this module: only counts and event labels are
 * reported to the server.
 */

export type ProctorEvent = { at: string; kind: string }
export type ProctorTermination = { reason: string; events: ProctorEvent[] }

type FaceDetectorInstance = {
  detect: (source: CanvasImageSource) => Promise<Array<{ boundingBox?: unknown }>>
}
type FaceDetectorCtor = new (opts?: { fastMode?: boolean }) => FaceDetectorInstance

const CHECK_INTERVAL_MS = 5_000
const MAX_CONSECUTIVE_MISSES = 3 // ~15s without a person before the assessment closes

function getFaceDetector(): FaceDetectorCtor | null {
  if (typeof window === 'undefined') return null
  const ctor = (window as unknown as { FaceDetector?: FaceDetectorCtor }).FaceDetector
  return typeof ctor === 'function' ? ctor : null
}

/** Standard deviation of grayscale samples — a covered lens gives a near-zero value. */
function frameFlatness(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const data = ctx.getImageData(0, 0, w, h).data
  const samples: number[] = []
  for (let i = 0; i < data.length; i += 40) {
    samples.push((data[i] + data[i + 1] + data[i + 2]) / 3)
  }
  if (samples.length === 0) return 0
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  const variance = samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / samples.length
  return Math.sqrt(variance)
}

export type CameraPermissionState = 'unknown' | 'granted' | 'prompt' | 'denied'

export function useCameraProctor(active: boolean, onTerminated: (t: ProctorTermination) => void) {
  const [cameraState, setCameraState] = useState<'idle' | 'requesting' | 'on' | 'denied'>('idle')
  // The browser's own permission state. Chrome only shows its native camera prompt when the
  // permission is in the "prompt" state AND the call comes from a user gesture on a secure
  // context; if it was denied before (or the page is not HTTPS), getUserMedia rejects silently
  // with no popup — which is exactly the "denied, cannot open" confusion.
  const [permissionState, setPermissionState] = useState<CameraPermissionState>('unknown')
  const [secureContext, setSecureContext] = useState(true)
  const [terminated, setTerminated] = useState<ProctorTermination | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const eventsRef = useRef<ProctorEvent[]>([])
  const missesRef = useRef(0)
  const detectorRef = useRef<FaceDetectorInstance | null>(null)
  const onTerminatedRef = useRef(onTerminated)
  onTerminatedRef.current = onTerminated

  const record = useCallback((kind: string) => {
    eventsRef.current.push({ at: new Date().toISOString(), kind })
    if (eventsRef.current.length > 200) eventsRef.current.splice(0, eventsRef.current.length - 200)
  }, [])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const terminate = useCallback(
    (reason: string) => {
      setTerminated((prev) => {
        if (prev) return prev
        const t = { reason, events: [...eventsRef.current] }
        stopCamera()
        setCameraState('idle')
        onTerminatedRef.current(t)
        return t
      })
    },
    [stopCamera],
  )
  const terminateRef = useRef(terminate)
  terminateRef.current = terminate

  // Track the browser permission state so the UI can explain *why* no prompt appeared and
  // auto-start the moment the user allows camera via the address-bar icon (no re-click needed).
  useEffect(() => {
    setSecureContext(typeof window !== 'undefined' && window.isSecureContext)
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return
    let status: PermissionStatus | null = null
    navigator.permissions
      .query({ name: 'camera' as PermissionName })
      .then((s) => {
        status = s
        setPermissionState(s.state as CameraPermissionState)
        s.onchange = () => {
          setPermissionState(s.state as CameraPermissionState)
          if (s.state === 'granted' && !streamRef.current) void startCameraRef.current()
        }
      })
      .catch(() => setPermissionState('unknown'))
    return () => {
      if (status) status.onchange = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startCamera = useCallback(async () => {
    if (streamRef.current || cameraState === 'requesting') return
    setCameraState('requesting')
    try {
      if (typeof window === 'undefined' || !window.isSecureContext) throw new Error('insecure-context')
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => terminateRef.current('camera-disconnected')
      })
      setCameraState('on')
      record('camera-started')
    } catch (err) {
      setCameraState('denied')
      // Refresh the permission state so the UI can tell "denied permanently" (fix via the
      // address-bar icon) from a transient failure.
      const name = err instanceof Error ? err.message : ''
      if (name === 'insecure-context') setPermissionState('denied')
      else if (navigator.permissions?.query) {
        navigator.permissions.query({ name: 'camera' as PermissionName }).then((ps) => setPermissionState(ps.state as CameraPermissionState)).catch(() => {})
      }
      record('camera-denied')
    }
  }, [cameraState, record])
  const startCameraRef = useRef(startCamera)
  startCameraRef.current = startCamera

  // Periodic person-presence check while the assessment is active.
  useEffect(() => {
    if (!active || cameraState !== 'on' || terminated) return
    const FD = getFaceDetector()
    if (FD && !detectorRef.current) {
      try {
        detectorRef.current = new FD({ fastMode: true })
      } catch {
        detectorRef.current = null
      }
    }
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 120
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const check = async () => {
      const video = videoRef.current
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        missesRef.current += 1
      } else {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        let personDetected = false
        if (detectorRef.current) {
          try {
            const faces = await detectorRef.current.detect(canvas)
            personDetected = faces.length > 0
          } catch {
            personDetected = true // detector hiccup — don't punish on a transient error
          }
        } else {
          // Fallback (no FaceDetector): a live face gives a non-flat frame; a covered lens or an
          // object held still gives near-zero variance.
          personDetected = frameFlatness(ctx, canvas.width, canvas.height) > 8
        }
        if (personDetected) {
          missesRef.current = 0
        } else {
          missesRef.current += 1
          record('no-person-detected')
        }
      }
      if (missesRef.current >= MAX_CONSECUTIVE_MISSES) {
        terminateRef.current('no-person-detected')
      }
    }

    const id = setInterval(check, CHECK_INTERVAL_MS)
    const onHidden = () => {
      if (document.hidden) record('tab-hidden')
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [active, cameraState, terminated, record])

  // (Re)attach the stream whenever the preview element (re)mounts while the camera is on — the
  // gate screen and the in-quiz preview are different elements.
  useEffect(() => {
    if (cameraState === 'on' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
    }
  }, [cameraState, active])

  // Stop the camera when the component unmounts.
  useEffect(() => () => stopCamera(), [stopCamera])

  return { cameraState, permissionState, secureContext, terminated, startCamera, videoRef, eventsRef }
}
