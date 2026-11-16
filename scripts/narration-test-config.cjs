const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
function reference(){
 const audio=process.env.NARRATION_REFERENCE_AUDIO;
 const text=process.env.NARRATION_REFERENCE_TEXT_FILE?fs.readFileSync(process.env.NARRATION_REFERENCE_TEXT_FILE,'utf8').trim():process.env.NARRATION_REFERENCE_TEXT?.trim();
 if(!audio||!path.isAbsolute(audio)||!fs.existsSync(audio)||!text)throw new Error('Set NARRATION_REFERENCE_AUDIO and NARRATION_REFERENCE_TEXT_FILE to your own local recording and transcript.');
 return {audio,text};
}
function python(){
 if(process.env.NARRATION_PYTHON)return process.env.NARRATION_PYTHON;
 const projects=path.join(os.homedir(),'CursorProjects');
 for(const name of fs.existsSync(projects)?fs.readdirSync(projects):[]){const candidate=path.join(projects,name,'Aixora-Studio','venv','python.exe');if(name.startsWith('audio.')&&fs.existsSync(candidate))return candidate;}
 throw new Error('Set NARRATION_PYTHON to the Python executable with the audio test dependencies.');
}
module.exports={reference,python};
