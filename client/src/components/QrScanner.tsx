import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { useI18n } from '../i18n';

type Status = 'starting' | 'scanning' | 'unsupported' | 'denied';

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/**
 * In-app QR scanner: camera frames are decoded on the device (native
 * BarcodeDetector when present, jsQR otherwise). Nothing leaves the device
 * except the decoded credential, which the caller exchanges over HTTPS.
 */
export default function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>('starting');
  const done = useRef(false);
  const cb = useRef(onResult);
  cb.current = onResult;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx2d = canvas.getContext('2d', { willReadFrequently: true });
    const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const native = Native ? new Native({ formats: ['qr_code'] }) : null;

    const emit = (text: string) => {
      if (done.current || !text) return;
      done.current = true;
      cb.current(text);
    };

    const tick = async () => {
      if (stopped || done.current) return;
      const v = video.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        try {
          if (native) {
            const found = await native.detect(v);
            if (found[0]) emit(found[0].rawValue);
          } else if (ctx2d) {
            const w = Math.min(640, v.videoWidth);
            const h = Math.round((v.videoHeight / v.videoWidth) * w);
            canvas.width = w;
            canvas.height = h;
            ctx2d.drawImage(v, 0, 0, w, h);
            const img = ctx2d.getImageData(0, 0, w, h);
            const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
            if (code?.data) emit(code.data);
          }
        } catch {
          /* keep scanning */
        }
      }
      raf = requestAnimationFrame(() => void tick());
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
        setStatus('unsupported');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        const v = video.current;
        if (stopped || !v) {
          // Closed before permission resolved: release the camera immediately.
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        v.srcObject = stream;
        v.setAttribute('playsinline', 'true');
        await v.play();
        setStatus('scanning');
        void tick();
      } catch (e) {
        setStatus((e as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unsupported');
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  if (status === 'unsupported') return <p className="note plain">{t('gate.scanUnsupported')}</p>;
  if (status === 'denied') return <p className="note plain">{t('gate.scanDenied')}</p>;
  return (
    <div className="scanner" aria-label={t('gate.scanTitle')}>
      <video ref={video} muted playsInline />
    </div>
  );
}
