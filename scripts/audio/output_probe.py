"""Measures digital signal arriving at the default Windows output, no microphone."""
import sys, threading, time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'.local'/'benchmark-deps'))
import numpy as np
import soundcard as sc
import pythoncom

class OutputProbe:
    def __init__(self):
        self.ready=threading.Event(); self.stop_event=threading.Event()
        self.started=None; self.first=None; self.error=None; self.baseline_peak=0.0
        self.thread=threading.Thread(target=self.run,daemon=True)
    def run(self):
        pythoncom.CoInitialize()
        try:
            speaker=sc.default_speaker(); self.device=speaker.name
            mic=sc.get_microphone(speaker.id,include_loopback=True)
            if not mic.isloopback: raise RuntimeError('Refusing microphone capture')
            with mic.recorder(samplerate=48000,channels=2,blocksize=480) as rec:
                self.ready.set()
                while not self.stop_event.is_set():
                    frames=rec.record(numframes=480)
                    at=time.perf_counter(); peak=float(np.max(np.abs(frames)))
                    if self.started is None: self.baseline_peak=max(self.baseline_peak,peak)
                    elif self.first is None and peak>0.003:
                        self.first=at-self.started
        except Exception as e: self.error=str(e); self.ready.set()
        finally: pythoncom.CoUninitialize()
    def __enter__(self):
        self.thread.start()
        if not self.ready.wait(5): raise RuntimeError('Output detector initialization timed out')
        if self.error: raise RuntimeError(self.error)
        time.sleep(.25)
        return self
    def begin(self):
        if self.baseline_peak>0.003: raise RuntimeError('Output was not quiet before test')
        self.started=time.perf_counter()
        return self.started
    def finish(self,timeout=3):
        deadline=time.monotonic()+timeout
        while self.first is None and self.error is None and time.monotonic()<deadline: time.sleep(.005)
        return {'output_signal_s':self.first,'device':self.device,'baseline_peak':self.baseline_peak,'probe_error':self.error,
                'method':'Software request to first non-silent WASAPI loopback block, 10 ms blocks; not a physical microphone/mouse measurement.'}
    def __exit__(self,*args):
        self.stop_event.set(); self.thread.join(3)
