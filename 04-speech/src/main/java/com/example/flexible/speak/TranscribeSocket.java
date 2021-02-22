/**
 * Copyright 2017 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.example.flexible.speak;

import com.google.api.gax.rpc.ApiStreamObserver;
import com.google.api.gax.rpc.BidiStreamingCallable;
import com.google.cloud.speech.v1.RecognitionConfig;
import com.google.cloud.speech.v1.RecognitionConfig.AudioEncoding;
import com.google.cloud.speech.v1.SpeechClient;
import com.google.cloud.speech.v1.StreamingRecognitionConfig;
import com.google.cloud.speech.v1.StreamingRecognitionResult;
import com.google.cloud.speech.v1.StreamingRecognizeRequest;
import com.google.cloud.speech.v1.StreamingRecognizeResponse;
import com.google.gson.Gson;
import com.google.logging.type.HttpRequest;
import com.google.protobuf.ByteString;
import io.grpc.auth.ClientAuthInterceptor;
import org.apache.http.HttpEntity;
import org.apache.http.HttpResponse;
import org.apache.http.NameValuePair;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.DefaultHttpClient;
import org.apache.http.impl.client.DefaultHttpRequestRetryHandler;
import org.apache.http.message.BasicNameValuePair;
import org.eclipse.jetty.websocket.api.WebSocketAdapter;
import java.lang.management.ManagementFactory;
import java.lang.management.RuntimeMXBean;
import java.util.List;
import org.apache.http.client.*;
import java.security.GeneralSecurityException;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;
import java.util.logging.Logger;

public class TranscribeSocket extends WebSocketAdapter
    implements ApiStreamObserver<StreamingRecognizeResponse> {

  private static final Logger logger = Logger.getLogger(TranscribeSocket.class.getName());
  ApiStreamObserver<StreamingRecognizeRequest> requestObserver;
  private Gson gson;
  SpeechClient speech;

  public TranscribeSocket() {
    gson = new Gson();
  }

  /**
   * Called when the client sends this server some raw bytes (ie audio data).
   */
  @Override
  public void onWebSocketBinary(byte[] payload, int offset, int len) {
    if (isConnected()) {
      StreamingRecognizeRequest request =
          StreamingRecognizeRequest.newBuilder()
              .setAudioContent(ByteString.copyFrom(payload, offset, len))
              .build();
      requestObserver.onNext(request);
    }
  }

  /**
   * Called when the client sends this server some text.
   */
  @Override
  public void onWebSocketText(String message) {
    if (isConnected()) {
      Constraints constraints = gson.fromJson(message, Constraints.class);
      logger.info(String.format("Got sampleRate: %s", constraints.sampleRate));

      try {
        speech = SpeechClient.create();
        BidiStreamingCallable<StreamingRecognizeRequest, StreamingRecognizeResponse> callable =
            speech.streamingRecognizeCallable();

        requestObserver = callable.bidiStreamingCall(this);
        // Build and send a StreamingRecognizeRequest containing the parameters for
        // processing the audio.
        RecognitionConfig config =
            RecognitionConfig.newBuilder()
            .setEncoding(AudioEncoding.LINEAR16)
            .setSampleRateHertz(constraints.sampleRate)
            .setLanguageCode("en-US")
            .build();
        StreamingRecognitionConfig streamingConfig =
            StreamingRecognitionConfig.newBuilder()
            .setConfig(config)
            .setInterimResults(true)
            .setSingleUtterance(false)
            .build();

        StreamingRecognizeRequest initial =
            StreamingRecognizeRequest.newBuilder().setStreamingConfig(streamingConfig).build();
        requestObserver.onNext(initial);

        getRemote().sendString(message);
      } catch (IOException e) {
        logger.log(Level.WARNING, "Error onWebSocketText", e);
      }
    }
  }

  public void closeApiChannel() {
    speech.close();
  }

  /**
   * Called when the connection to the client is closed.
   */
  @Override
  public void onWebSocketClose(int statusCode, String reason) {
    logger.info("Websocket close.");
    requestObserver.onCompleted();
    closeApiChannel();
  }

  /**
   * Called if there's an error connecting with the client.
   */
  @Override
  public void onWebSocketError(Throwable cause) {
    logger.log(Level.WARNING, "Websocket error", cause);
    requestObserver.onError(cause);
    closeApiChannel();
  }

/**
   * Called when the Speech API has a transcription result for us.
   */
  @Override
  public void onNext(StreamingRecognizeResponse response) {
   String token = System.getProperty("token");
    List<StreamingRecognitionResult> results = response.getResultsList();
    if (results.size() < 1) {
      return;
    }

    try {
      StreamingRecognitionResult result = results.get(0);
      logger.info("Got result :" + result);
      String transcript = result.getAlternatives(0).getTranscript();
      logger.info("Transcript : " + transcript);
      String req = "{\"query_input\":{\"text\":{\"text\":\""+transcript+"\",\"language_code\":\"en-US\"}}}";
      logger.info("Request req is : " + "{\"query_input\":{\"text\":{\"text\":\""+transcript+"\",\"language_code\":\"en-US\"}}}");
      //logger.info("Request req is : " + req);
      String jsonInString = new Gson().toJson(req);
      logger.info("Request Json is : " + jsonInString);
      logger.info("Get property token : " + System.getProperty("token"));
      HttpClient client = new DefaultHttpClient();
      HttpPost post = new HttpPost("https://dialogflow.googleapis.com/v2/projects/gold-freedom-304212/agent/sessions/12345:detectIntent");
      //RuntimeMXBean runtimeMxBean = ManagementFactory.getRuntimeMXBean();
      //List<String> arguments = runtimeMxBean.getInputArguments();
      //logger.info("arguments : " + arguments);
      //for(String args : arguments){
       // if(args != null && args.contains("token")){
        //  if(args.split("=").length > 1) {
         //   token = args.split("=")[1];
     //     }
     //   }
     // } 
       
      logger.info("Token argument " + token);
      post.addHeader("Authorization", "Bearer " + token);
    //  post.addHeader("Content-Type", "application/json; charset=utf-8");
      try {
        StringEntity entity = new StringEntity(jsonInString);
        post.setEntity(entity);

        HttpResponse res = client.execute(post);
        logger.log(Level.INFO,"Response : " , res);
        getRemote().sendString(gson.toJson(res));
      } catch (IOException e) {
        logger.log(Level.WARNING, "Error sending to websocket", e);
      }
    }catch (Exception e) {
      logger.log(Level.WARNING, "Error sending to websocket", e);
    }
  }


  /**
   * Called if the API call throws an error.
   */
  @Override
  public void onError(Throwable error) {
    logger.log(Level.WARNING, "recognize failed", error);
    // Close the websocket
    getSession().close(500, error.toString());
    closeApiChannel();
  }

  /**
   * Called when the API call is complete.
   */
  @Override
  public void onCompleted() {
    logger.info("recognize completed.");
    // Close the websocket
    getSession().close();
    closeApiChannel();
  }

  // Taken wholesale from StreamingRecognizeClient.java
  private static final List<String> OAUTH2_SCOPES =
      Arrays.asList("https://www.googleapis.com/auth/cloud-platform");
}
