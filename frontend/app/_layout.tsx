import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useFonts } from "expo-font";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";

LogBox.ignoreLogs([
  // Known RN-Web deprecations that clutter the console without affecting behavior.
  "props.pointerEvents is deprecated",
  "shadow* style props are deprecated",
]);

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [iconsLoaded, iconsError] = useIconFonts();
  const [fontsLoaded, fontsError] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  useEffect(() => {
    if ((iconsLoaded || iconsError) && (fontsLoaded || fontsError)) {
      SplashScreen.hideAsync();
    }
  }, [iconsLoaded, iconsError, fontsLoaded, fontsError]);

  if ((!iconsLoaded && !iconsError) || (!fontsLoaded && !fontsError)) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#111111" }}>
      <BottomSheetModalProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#111111" },
            animation: "slide_from_right",
          }}
        />
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
