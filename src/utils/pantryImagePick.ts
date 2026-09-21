import { Alert, ActionSheetIOS, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export type PantryImagePickResult = {
    uri: string;
} | null;

type Translate = (key: string) => string;

async function ensureLibraryPermission(t: Translate): Promise<boolean> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.granted) return true;
    Alert.alert(t('pantryVision.permissionTitle'), t('pantryVision.permissionLibrary'));
    return false;
}

async function ensureCameraPermission(t: Translate): Promise<boolean> {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.granted) return true;
    Alert.alert(t('pantryVision.permissionTitle'), t('pantryVision.permissionCamera'));
    return false;
}

async function launchLibrary(t: Translate): Promise<PantryImagePickResult> {
    if (!(await ensureLibraryPermission(t))) return null;
    const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return null;
    return { uri: result.assets[0].uri };
}

async function launchCamera(t: Translate): Promise<PantryImagePickResult> {
    if (!(await ensureCameraPermission(t))) return null;
    const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return null;
    return { uri: result.assets[0].uri };
}

/**
 * Prompt camera vs library, then return a local image URI (JPEG-ish via quality).
 */
export async function pickPantryImage(t: Translate): Promise<PantryImagePickResult> {
    if (Platform.OS === 'ios') {
        return new Promise((resolve) => {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    options: [
                        t('common.cancel'),
                        t('pantryVision.takePhoto'),
                        t('pantryVision.chooseLibrary'),
                    ],
                    cancelButtonIndex: 0,
                },
                async (index) => {
                    if (index === 1) resolve(await launchCamera(t));
                    else if (index === 2) resolve(await launchLibrary(t));
                    else resolve(null);
                },
            );
        });
    }

    return new Promise((resolve) => {
        Alert.alert(t('pantryVision.scan'), t('pantryVision.pickSource'), [
            { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(null) },
            {
                text: t('pantryVision.takePhoto'),
                onPress: () => {
                    void launchCamera(t).then(resolve);
                },
            },
            {
                text: t('pantryVision.chooseLibrary'),
                onPress: () => {
                    void launchLibrary(t).then(resolve);
                },
            },
        ]);
    });
}
