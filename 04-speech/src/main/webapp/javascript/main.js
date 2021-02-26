
(function playButtonHandler() {
  // The play button is the canonical state, which changes via events.
  var playButton = document.getElementById('speaker-ai-button');
  var micropIcon = playButton.firstElementChild;
  
  playButton.addEventListener('click', function (e) {
    if (micropIcon.classList.contains('fa-pause')) {
      playButton.dispatchEvent(new Event('pause'));
    } else {
      playButton.dispatchEvent(new Event('play'));
    }
  }, true);

  // Update the appearance when the state changes
  playButton.addEventListener('play', function (e) {
    micropIcon.classList.remove('fa-microphone');
    micropIcon.classList.add('fa-pause');
    console.log("now playng..");
  });
  playButton.addEventListener('pause', function (e) {
    micropIcon.classList.remove('fa-pause');
    micropIcon.classList.add('fa-microphone');
    console.log("now paused..");
  });
})();

(function audioInit() {
  // Check for non Web Audio API browsers.
  if (!window.AudioContext) {
    alert("Web Audio isn't available in your browser.");
    return;
  }

  // var canvas = document.getElementById('fft');
  // var ctx = canvas.getContext('2d');

  // var canvas2 = document.getElementById('fft2');
  // var ctx2 = canvas2.getContext('2d');
  // const CANVAS_HEIGHT = canvas.height;
  // const CANVAS_WIDTH = canvas.width;

  // var analyser;

  // function rafCallback(time) {
  //   window.requestAnimationFrame(rafCallback, canvas);

  //   if (!analyser) return;
  //   var freqByteData = new Uint8Array(analyser.frequencyBinCount);
  //   analyser.getByteFrequencyData(freqByteData); //analyser.getByteTimeDomainData(freqByteData);

  //   var SPACER_WIDTH = 10;
  //   var BAR_WIDTH = 5;
  //   var OFFSET = 100;
  //   var CUTOFF = 23;
  //   var numBars = Math.round(CANVAS_WIDTH / SPACER_WIDTH);

  //   ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  //   ctx.fillStyle = '#F6D565';
  //   ctx.lineCap = 'round';

  //   ctx2.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  //   ctx2.fillStyle = '#3A5E8C';
  //   ctx2.lineCap = 'round';

  //   // Draw rectangle for each frequency bin.
  //   for (var i = 0; i < numBars; ++i) {
  //     var magnitude = freqByteData[i + OFFSET];
  //     ctx.fillRect(i * SPACER_WIDTH, CANVAS_HEIGHT, BAR_WIDTH, -magnitude);
  //     ctx2.fillRect(i * SPACER_WIDTH, CANVAS_HEIGHT, BAR_WIDTH, -magnitude);
  //   }
  // }
  // rafCallback();

  // // per https://g.co/cloud/speech/reference/rest/v1beta1/RecognitionConfig
  const SAMPLE_RATE = 16000;
  const SAMPLE_SIZE = 16;

  var playButton = document.getElementById('speaker-ai-button');

  // Hook up the play/pause state to the microphone context
  var context = new AudioContext();
  // playButton.addEventListener('pause', context.suspend.bind(context));
  playButton.addEventListener('play', context.resume.bind(context));

  // The first time you hit play, connect to the microphone
  playButton.addEventListener('play', function startRecording() {
    var audioPromise = navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        channelCount: 1,
        sampleRate: {
          ideal: SAMPLE_RATE
        },
        sampleSize: SAMPLE_SIZE
      }
    });

    audioPromise.then(function (micStream) {
      var microphone = context.createMediaStreamSource(micStream);
      analyser = context.createAnalyser();
      microphone.connect(analyser);
    }).catch(console.log.bind(console));

    initWebsocket(audioPromise);
  }, { once: true });


  /**
   * Hook up event handlers to create / destroy websockets, and audio nodes to
   * transmit audio bytes through it.
   */
  function initWebsocket(audioPromise) {
    var socket;
    var sourceNode;

    // Create a node that sends raw bytes across the websocket
    var scriptNode = context.createScriptProcessor(4096, 1, 1);
    // Need the maximum value for 16-bit signed samples, to convert from float.
    const MAX_INT = Math.pow(2, 16 - 1) - 1;
    scriptNode.addEventListener('audioprocess', function (e) {
      var floatSamples = e.inputBuffer.getChannelData(0);
      // The samples are floats in range [-1, 1]. Convert to 16-bit signed
      // integer.
      socket.send(Int16Array.from(floatSamples.map(function (n) {
        return n * MAX_INT;
      })));
    });

    function newWebsocket() {
      var websocketPromise = new Promise(function (resolve, reject) {
        var socket = new WebSocket('wss://' + location.host + '/transcribe');
        socket.addEventListener('open', resolve);
        socket.addEventListener('error', reject);
      });

      Promise.all([audioPromise, websocketPromise]).then(function (values) {
        var micStream = values[0];
        socket = values[1].target;

        // If the socket is closed for whatever reason, pause the mic
        socket.addEventListener('close', function (e) {
          console.log('Websocket closing..');
          playButton.dispatchEvent(new Event('pause'));
        });
        socket.addEventListener('error', function (e) {
          console.log('Error from websocket', e);
          playButton.dispatchEvent(new Event('pause'));
        });

        function startByteStream(e) {
          // Hook up the scriptNode to the mic
          sourceNode = context.createMediaStreamSource(micStream);
          sourceNode.connect(scriptNode);
          scriptNode.connect(context.destination);
        }

        // Send the initial configuration message. When the server acknowledges
        // it, start streaming the audio bytes to the server and listening for
        // transcriptions.
        socket.addEventListener('message', function (e) {
          socket.addEventListener('message', onTranscription);
          startByteStream(e);
        }, { once: true });

        socket.send(JSON.stringify({ sampleRate: context.sampleRate }));

      }).catch(console.log.bind(console));
    }

    function synthVoice(text) {
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance();
      utterance.text = text;
      synth.speak(utterance);
    }

    function closeWebsocket() {
      scriptNode.disconnect();
      if (sourceNode) sourceNode.disconnect();
      if (socket && socket.readyState === socket.OPEN) socket.close();
    }
    

    function toggleWebsocket(e) {
      var context = e.target;
      if (context.state === 'running') {
        newWebsocket();
      } else if (context.state === 'suspended') {
        closeWebsocket();
      }
    }

//     var transcript = {
//       el: document.getElementById('transcript').childNodes[0],      
//       current: document.createElement('div')
//     };
//     alert(transcript);
//     alert(transcript.e1);
//     transcript.el.appendChild(transcript.current);
    /**
     * This function is called with the transcription result from the server.
     */
    function onTranscription(e) {
      console.log("testing..");
      console.log(e);
      var transcript = document.getElementById('transcript');
//       var closeBut = document.getElementById('close-modal-button');
      var result = JSON.parse(e.data);
      var disText = result.map;
      if (disText.fulfillmentText) {
        console.log(disText.fulfillmentText);
        synthVoice(disText.fulfillmentText);
        transcript.innerText = disText.fulfillmentText;
//         if(disText.fulfillmentText.includes("goodbye")){
//           closeWebsocket();
//           closeBut.click();
//         }
//         transcript.current = document.createElement('div');
//         transcript.el.appendChild(transcript.current);
      }
//       synthVoice(disText.fulfillmentText);
      //       if (result.alternatives_) {
      //         transcript.current.innerHTML = result.alternatives_[0].transcript_;
      //       }
      //       if (result.isFinal_) {
      //         transcript.current = document.createElement('div');
      //         transcript.el.appendChild(transcript.current);
      //       }
    }

    // When the mic is resumed or paused, change the state of the websocket too
    context.addEventListener('statechange', toggleWebsocket);
    // initialize for the current state
    toggleWebsocket({ target: context });
  }
})();

