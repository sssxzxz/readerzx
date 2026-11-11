import { VOICE_COMMANDS } from '../shared/voice';
// The grammar and dispatch table share one static list; user text is never code.
const cases = Object.entries(VOICE_COMMANDS).map(([text, command]) => `case "${text}": return "${command}";`).join('\n');
const phrases = Object.entries(VOICE_COMMANDS).filter(([, command]) => command !== 'next' && command !== 'prev').map(([text]) => `"${text}"`).join(', ');
export const voiceScript = String.raw`
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $source = @'
using System;
using System.IO;
using System.Speech.Recognition;

public static class ReaderVoice {
  public static string Direction(string text) {
    switch (text) {
      ${cases}
      default: return null;
    }
  }

  private static void LoadCommands(SpeechRecognitionEngine engine, RecognizerInfo chinese) {
    var builder = new GrammarBuilder();
    builder.Culture = chinese.Culture;
    builder.Append(new Choices(${phrases}));
    engine.LoadGrammar(new Grammar(builder));
    // Keep paging independent: a combined grammar can confuse up and down.
    var paging = new GrammarBuilder();
    paging.Culture = chinese.Culture;
    paging.Append(new Choices("下一页", "上一页", "上翻", "下翻"));
    engine.LoadGrammar(new Grammar(paging));
  }

  private static string RecognizeCommand(RecognitionResult result, SpeechRecognitionEngine pagingVerifier) {
    var command = Direction(result.Text);
    var threshold = result.Text.Length <= 2 ? 0.80f : 0.65f;
    if (command != null) return result.Confidence >= threshold ? result.Text : null;
    // Dictation can swallow short paging phrases. Only recheck uncertain, short
    // utterances against paging; this path can never zoom or change fullscreen.
    if (result.Text.Length > 3 || result.Confidence >= 0.55f || result.Audio.Duration.TotalSeconds > 3) return null;
    try {
      using (var audio = new MemoryStream()) {
        result.Audio.WriteToWaveStream(audio);
        audio.Position = 0;
        pagingVerifier.SetInputToWaveStream(audio);
        var confirmed = pagingVerifier.Recognize(TimeSpan.FromSeconds(2));
        return confirmed != null && confirmed.Confidence >= 0.90f ? confirmed.Text : null;
      }
    } catch { return null; }
    finally {
      // Stop may dispose the verifier while this callback is finishing.
      try { pagingVerifier.SetInputToNull(); } catch (ObjectDisposedException) { }
    }
  }

  public static void Run() {
    RecognizerInfo chinese = null;
    foreach (var info in SpeechRecognitionEngine.InstalledRecognizers()) {
      if (info.Culture.Name == "zh-CN") { chinese = info; break; }
    }
    if (chinese == null) { Console.WriteLine("error:no-recognizer"); return; }
    using (var engine = new SpeechRecognitionEngine(chinese))
    using (var pagingVerifier = new SpeechRecognitionEngine(chinese)) {
      LoadCommands(engine, chinese);
      // Ordinary speech must compete with commands instead of being forced into one.
      engine.LoadGrammar(new DictationGrammar());
      var paging = new GrammarBuilder();
      paging.Culture = chinese.Culture;
      paging.Append(new Choices("下一页", "上一页", "上翻", "下翻"));
      pagingVerifier.LoadGrammar(new Grammar(paging));
      engine.SpeechRecognized += (sender, e) => {
        var text = RecognizeCommand(e.Result, pagingVerifier);
        var direction = text == null ? null : Direction(text);
        if (direction != null)
          Console.WriteLine("command:" + direction + ":" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(text)));
        else Console.WriteLine("status:unrecognized");
      };
      engine.SpeechDetected += (sender, e) => Console.WriteLine("status:hearing");
      engine.SpeechRecognitionRejected += (sender, e) => Console.WriteLine("status:unrecognized");
      engine.RecognizeCompleted += (sender, e) => {
        if (e.Error != null) Console.WriteLine("error:recognition");
      };
      try { engine.SetInputToDefaultAudioDevice(); }
      catch { Console.WriteLine("error:microphone"); return; }
      engine.RecognizeAsync(RecognizeMode.Multiple);
      Console.WriteLine("ready");
      // EOF (parent exits/stops) releases the microphone and recognizer.
      Console.ReadLine();
      engine.RecognizeAsyncCancel();
    }
  }
}
'@
  Add-Type -TypeDefinition $source -ReferencedAssemblies ([System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location)
  [ReaderVoice]::Run()
} catch {
  [Console]::WriteLine('error:recognition')
  exit 1
}
`;
