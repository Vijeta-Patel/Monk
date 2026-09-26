plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.monk.tally"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.monk.tally"
        minSdk = 26
        targetSdk = 35
        versionCode = 13
        versionName = "1.3.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Demo builds sign with the debug key so the APK installs on the emulator as-is.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
}
