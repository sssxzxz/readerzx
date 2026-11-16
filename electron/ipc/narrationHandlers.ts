import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { NarrationService } from '../narrationService';
import type { NarrationApi } from '../../shared/narration';

export function registerNarrationHandlers():()=>Promise<void> {
  // A hidden reader still needs timely audio-end callbacks between cached sentences.
  ipcMain.on('narration:playback-active',(event,active:unknown)=>{
    if(typeof active==='boolean'&&!event.sender.isDestroyed())event.sender.setBackgroundThrottling(!active);
  });
  const service=new NarrationService(path.join(app.getPath('userData'),'narration'),app.getAppPath(),()=>{
    for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed())win.webContents.send('narration:changed');
  });
  const names=['state','configure','renameVoice','deleteVoice','referenceAudio','preview','createJob','job','control','prioritize','audio'] as const;
  for(const name of names)ipcMain.handle('narration:'+name,(_e,...args:any[])=>(service[name] as (...a:any[])=>unknown).apply(service,args));
  ipcMain.handle('narration:importReference',async(_e,name:string,text:string,file?:string)=>{
    if(!file){const result=await dialog.showOpenDialog({title:'选择音色录音',properties:['openFile'],filters:[{name:'录音',extensions:['wav','mp3','m4a','flac','ogg']}]});if(result.canceled)return null;file=result.filePaths[0];}
    return service.importReference(name,text,file);
  });
  return ()=>service.close();
}
